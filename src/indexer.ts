import { StargateClient, Block } from "@cosmjs/stargate"
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, desc } from "drizzle-orm";
import * as lavajs from '@lavanet/lavajs';
import * as schema from './schema';
import { PromisePool } from '@supercharge/promise-pool'
import { LavaBlock, GetOneLavaBlock } from './lavablock'
import { UpdateLatestBlockMeta, GetOrSetConsumer, GetOrSetPlan, GetOrSetProvider, GetOrSetSpec } from './setlatest'
import { MigrateDb, GetDb } from "./utils";

const rpc = "https://public-rpc.lavanet.xyz/"
const lava_testnet2_start_height = 340779; // 340778 has a weird date (9 months ago)
let static_dbProviders: Map<string, schema.Provider> = new Map()
let static_dbSpecs: Map<string, schema.Spec> = new Map()
let static_dbPlans: Map<string, schema.Plan> = new Map()
let static_dbStakes: Map<string, schema.ProviderStake[]> = new Map()

async function isBlockInDb(
    db: PostgresJsDatabase,
    height: number,
): Promise<boolean> {
    //
    // Is in DB already?
    const dbBlock = await db.select().from(schema.blocks).where(eq(schema.blocks.height, height));
    if (dbBlock.length != 0) {
        return true
    }
    return false
}

async function InsertBlock(
    block: LavaBlock,
    db: PostgresJsDatabase,
) {
    //
    // Init
    let dbProviders: Map<string, schema.Provider> = new Map()
    let dbSpecs: Map<string, schema.Spec> = new Map()
    let dbConsumers: Map<string, schema.Consumer> = new Map()
    let dbPlans: Map<string, schema.Plan> = new Map()
    //
    let dbEvents: schema.InsertEvent[] = []
    let dbPayments: schema.InsertRelayPayment[] = []
    let dbConflictResponses: schema.InsertConflictResponse[] = []
    let dbSubscriptionBuys: schema.InsertSubscriptionBuy[] = []
    let dbConflictVote: schema.InsertConflictVote[] = []

    //
    // Stake related
    block.stakeNewProviderEvts.forEach((evt) => {
        GetOrSetProvider(dbProviders, static_dbProviders, evt.provider, evt.moniker)
        GetOrSetSpec(dbSpecs, static_dbSpecs, evt.spec)

        dbEvents.push({
            blockId: block?.height,
            eventType: schema.LavaProviderEventType.StakeNewProvider,
            provider: evt.provider,
        } as schema.InsertEvent)
    })
    block.stakeUpdateProviderEvts.forEach((evt) => {
        GetOrSetProvider(dbProviders, static_dbProviders, evt.provider, evt.moniker)
        GetOrSetSpec(dbSpecs, static_dbSpecs, evt.spec)

        dbEvents.push({
            blockId: block?.height,
            eventType: schema.LavaProviderEventType.StakeUpdateProvider,
            provider: evt.provider
        } as schema.InsertEvent)
    })
    block.providerUnstakeCommitEvts.forEach((evt) => {
        GetOrSetProvider(dbProviders, static_dbProviders, evt.address, evt.moniker)
        GetOrSetSpec(dbSpecs, static_dbSpecs, evt.chainID)

        dbEvents.push({
            blockId: block?.height,
            eventType: schema.LavaProviderEventType.ProviderUnstakeCommit,
            provider: evt.address
        } as schema.InsertEvent)
    })

    //
    // Freeze related
    block.freezeProviderEvts.forEach((evt) => {
        GetOrSetProvider(dbProviders, static_dbProviders, evt.providerAddress, '')
        evt.chainIDs.forEach((specId) => {
            GetOrSetSpec(dbSpecs, static_dbSpecs, specId)
        })

        dbEvents.push({
            blockId: block?.height,
            eventType: schema.LavaProviderEventType.FreezeProvider,
            provider: evt.providerAddress
        } as schema.InsertEvent)
    })
    block.unfreezeProviderEvts.forEach((evt) => {
        GetOrSetProvider(dbProviders, static_dbProviders, evt.providerAddress, '')
        evt.chainIDs.forEach((specId) => {
            GetOrSetSpec(dbSpecs, static_dbSpecs, specId)
        })

        dbEvents.push({
            blockId: block?.height,
            eventType: schema.LavaProviderEventType.UnfreezeProvider,
            provider: evt.providerAddress
        } as schema.InsertEvent)
    })

    //
    // Payment related
    block.relayPaymentEvts.forEach((evt) => {
        GetOrSetProvider(dbProviders, static_dbProviders, evt.provider, '')
        GetOrSetSpec(dbSpecs, static_dbSpecs, evt.chainID)
        GetOrSetConsumer(dbConsumers, evt.client)

        dbPayments.push({
            blockId: block?.height,
            specId: evt.chainID,
            provider: evt.provider,
            //
            cu: evt.CU,
            pay: evt.BasePay,
            //
            qosAvailability: evt.QoSAvailability,
            qosLatency: evt.QoSLatency,
            qosSync: evt.QoSLatency,
            //
            qosAvailabilityExc: evt.ExcellenceQoSAvailability,
            qosLatencyExc: evt.ExcellenceQoSLatency,
            qosSyncExc: evt.ExcellenceQoSLatency,
            //
            relays: evt.relayNumber,
            consumer: evt.client
        } as schema.InsertRelayPayment)
    })

    //
    // Plans / Subscriptions related
    block.buySubscriptionEvts.forEach((evt) => {
        GetOrSetConsumer(dbConsumers, evt.consumer)
        GetOrSetPlan(dbPlans, static_dbPlans, evt.plan)

        dbSubscriptionBuys.push({
            blockId: block?.height,
            consumer: evt.consumer,
            duration: evt.duration,
            plan: evt.plan,
        } as schema.InsertSubscriptionBuy)
    })

    //
    // Conflict related
    block.responseConflictDetectionEvts.forEach((evt) => {
        GetOrSetSpec(dbSpecs, static_dbSpecs, evt.chainID)
        GetOrSetConsumer(dbConsumers, evt.client)

        dbConflictResponses.push({
            blockId: block?.height,
            consumer: evt.client,

            apiInterface: evt.apiInterface,
            apiURL: evt.apiURL,
            connectionType: evt.connectionType,
            requestBlock: evt.requestBlock,
            requestData: evt.requestData,
            specId: evt.chainID,
            voteDeadline: evt.voteDeadline,
            voteId: evt.voteID,
        } as schema.InsertConflictResponse)
    })
    block.conflictVoteGotCommitEvts.forEach((evt) => {
        GetOrSetProvider(dbProviders, static_dbProviders, evt.provider, '')

        dbConflictVote.push({
            blockId: block?.height,
            provider: evt.provider,
            voteId: evt.voteID,
        } as schema.ConflictVote)
    })

    //
    // We use a transaction to revert insert on any errors
    await db.transaction(async (tx) => {
        // insert block
        await tx.insert(schema.blocks).values({ height: block.height, datetime: new Date(block.datetime) })

        // Insert all specs
        const arrSpecs = Array.from(dbSpecs.values())
        if (arrSpecs.length > 0) {
            await tx.insert(schema.specs)
                .values(arrSpecs)
                .onConflictDoNothing();
        }
        // Find / create all providers
        const arrProviders = Array.from(dbProviders.values())
        if (arrProviders.length > 0) {
            await tx.insert(schema.providers)
                .values(arrProviders)
                .onConflictDoNothing();
        }
        // Find / create all plans
        const arrPlans = Array.from(dbPlans.values())
        if (arrPlans.length > 0) {
            await tx.insert(schema.plans)
                .values(arrPlans)
                .onConflictDoNothing();
        }
        // Find / create all consumers
        const arrConsumers = Array.from(dbConsumers.values())
        if (arrConsumers.length > 0) {
            await tx.insert(schema.consumers)
                .values(arrConsumers)
                .onConflictDoNothing();
        }
        // Create
        if (dbEvents.length > 0) {
            await tx.insert(schema.events).values(dbEvents)
        }
        if (dbPayments.length > 0) {
            await tx.insert(schema.relayPayments).values(dbPayments)
        }
        if (dbConflictResponses.length > 0) {
            await tx.insert(schema.conflictResponses).values(dbConflictResponses)
        }
        if (dbSubscriptionBuys.length > 0) {
            await tx.insert(schema.subscriptionBuys).values(dbSubscriptionBuys)
        }
        if (dbConflictVote.length > 0) {
            await tx.insert(schema.conflictVotes).values(dbConflictVote)
        }
    })
}

const doBatch = async (
    db: PostgresJsDatabase,
    client: StargateClient,
    dbHeight: number,
    latestHeight: number,
) => {
    //
    // Start filling up
    const batchSize = 250
    const concurrentSize = 2
    const blockList = []
    for (let i = dbHeight; i <= latestHeight; i++) {
        blockList.push(i)
    }
    while (blockList.length > 0) {
        let start = performance.now();

        const tmpList = blockList.splice(0, batchSize);
        const { results, errors } = await PromisePool
            .withConcurrency(concurrentSize)
            .for(tmpList)
            .process(async (height) => {
                if (await isBlockInDb(db, height)) {
                    return
                }

                let block: null | LavaBlock = null;
                block = await GetOneLavaBlock(height, client)
                if (block != null) {
                    await InsertBlock(block, db)
                } else {
                    console.log('failed getting block', height)
                }
            })

        let timeTaken = performance.now() - start;
        console.log(
            'errors', errors,
            'batches remaining:', blockList.length / batchSize,
            'time', timeTaken / 1000,
            'est remaining:', Math.trunc((timeTaken / 1000) * blockList.length / batchSize), 's'
        )
        //
        // Add errors to start of queue
        // TODO: delay the execution of this to the next iteration
        errors.forEach((err) => {
            blockList.unshift(err.item)
        })
    }
}

const indexer = async (): Promise<void> => {
    //
    // Client
    const client = await StargateClient.connect(rpc)
    const chainId = await client.getChainId()
    const height = await client.getHeight()
    const lavajsClient = await lavajs.lavanet.ClientFactory.createRPCQueryClient({ rpcEndpoint: rpc })
    console.log('chain', chainId, 'current height', height)

    //
    // DB
    await MigrateDb()
    const db = GetDb()

    //
    // Insert providers, specs & plans from latest block 
    await UpdateLatestBlockMeta(
        db,
        lavajsClient,
        height,
        false,
        static_dbProviders,
        static_dbSpecs,
        static_dbPlans,
        static_dbStakes
    )

    //
    // Loop forever, filling up blocks
    const pollEvery = 3000 // ms
    const loopFill = () => (setTimeout(fillUp, pollEvery))
    const fillUp = async () => {
        //
        // Blockchain latest
        let latestHeight = 0
        try {
            latestHeight = await client.getHeight();
        } catch (e) {
            console.log('client.getHeight', e)
            loopFill()
            return
        }


        //
        // Find latest block on DB
        let dbHeight = lava_testnet2_start_height
        const latestDbBlock = await db.select().from(schema.blocks).orderBy(desc(schema.blocks.height)).limit(1)
        if (latestDbBlock.length != 0) {
            const tHeight = latestDbBlock[0].height
            if (tHeight != null) {
                dbHeight = tHeight
            }
        }

        //
        // Found diff, start
        if (latestHeight > dbHeight) {
            console.log('db height', dbHeight, 'blockchain height', latestHeight)
            await doBatch(db, client, dbHeight, latestHeight)

            //
            // Get the latest meta from RPC if not catching up
            // catching up = more than 1 block being indexed
            if (latestHeight - dbHeight == 1) {
                try {
                    await UpdateLatestBlockMeta(
                        db,
                        lavajsClient,
                        height,
                        true,
                        static_dbProviders,
                        static_dbSpecs,
                        static_dbPlans,
                        static_dbStakes
                    )
                } catch (e) {
                    console.log('UpdateLatestBlockMeta', e)
                }
            }
        }
        loopFill()
    }
    fillUp()
}

indexer()
