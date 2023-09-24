
import Fastify, { FastifyInstance, RouteShorthandOptions } from 'fastify'
import { sql, desc, eq } from "drizzle-orm";
import * as schema from './schema';
import { GetDb } from './utils';

const db = GetDb()

const server: FastifyInstance = Fastify({
    logger: true,
})

const latestOpts: RouteShorthandOptions = {
    schema: {
        response: {
            200: {
                type: 'object',
                properties: {
                    height: {
                        type: 'number'
                    },
                    datetime: {
                        type: 'number'
                    },
                    cuSum: {
                        type: 'number'
                    },
                    relaySum: {
                        type: 'number'
                    },
                    rewardSum: {
                        type: 'number'
                    },
                    stakeSum: {
                        type: 'number'
                    }
                }
            }
        }
    }
}

server.get('/latest', latestOpts, async (request, reply) => {
    //
    const latestDbBlocks = await db.select().from(schema.blocks).orderBy(desc(schema.blocks.height)).limit(1)
    let latestHeight = 0
    let latestDatetime = 0
    if (latestDbBlocks.length != 0) {
        latestHeight = latestDbBlocks[0].height == null ? 0 : latestDbBlocks[0].height
        latestDatetime = latestDbBlocks[0].datetime == null ? 0 : latestDbBlocks[0].datetime.getTime()
    }

    //
    // Get total payments and more
    let cuSum = 0
    let relaySum = 0
    let rewardSum = 0
    let res = await db.select({
        cuSum: sql<number>`sum(${schema.relayPayments.cu})`,
        relaySum: sql<number>`sum(${schema.relayPayments.relays})`,
        rewardSum: sql<number>`sum(${schema.relayPayments.pay})`
    }).from(schema.relayPayments)
    if (res.length != 0) {
        cuSum = res[0].cuSum
        relaySum = res[0].relaySum
        rewardSum = relaySum = res[0].rewardSum
    }

    //
    // Get total provider stake
    let stakeSum = 0
    let res2 = await db.select({
        stakeSum: sql<number>`sum(${schema.providerStakes.stake})`,
    }).from(schema.providerStakes)
    if (res2.length != 0) {
        stakeSum = res2[0].stakeSum
    }

    //
    // Get graph with 1 day resolution
    let res3 = await db.select({
        date: schema.blocks.datetime,
        chainId: sql`${schema.relayPayments.specId}`,
        cuSum: sql<number>`sum(${schema.relayPayments.cu})`,
        relaySum: sql<number>`sum(${schema.relayPayments.relays})`,
        rewardSum: sql<number>`sum(${schema.relayPayments.pay})`
    }).from(schema.relayPayments).
        leftJoin(schema.blocks, eq(schema.relayPayments.blockId, schema.blocks.height)).
        groupBy(sql`${schema.relayPayments.specId}`).
        groupBy(sql<Date>`DATE(${schema.blocks.datetime})`)
    console.log(res3)

    return {
        height: latestHeight,
        datetime: latestDatetime,
        cuSum: cuSum,
        relaySum: relaySum,
        rewardSum: rewardSum,
        stakeSum: stakeSum,
    }
})

const providerOpts: RouteShorthandOptions = {
    schema: {
        response: {
            200: {
                type: 'object',
                properties: {
                    addr: {
                        type: 'string'
                    },
                    moniker: {
                        type: 'string'
                    },
                    cuSum: {
                        type: 'number'
                    },
                    relaySum: {
                        type: 'number'
                    },
                    rewardSum: {
                        type: 'number'
                    },
                    events: {
                        type: 'array',
                    }
                }
            }
        }
    }
}

server.get('/provider/:addr', providerOpts, async (request, reply) => {
    const { addr } = request.params as { addr: string }
    if (addr.length != 44) {
        return {} // TODO: errors
    }
    if (!addr.startsWith('lava@')) {
        return {} // TODO: errors
    }

    //
    const res = await db.select().from(schema.providers).where(eq(schema.providers.address, addr))
    if (res.length != 1) {
        return {} // TODO: errors
    }
    const provider = res[0]

    //
    let cuSum = 0
    let relaySum = 0
    let rewardSum = 0
    const res2 = await db.select({
        cuSum: sql<number>`sum(${schema.relayPayments.cu})`,
        relaySum: sql<number>`sum(${schema.relayPayments.relays})`,
        rewardSum: sql<number>`sum(${schema.relayPayments.pay})`
    }).from(schema.relayPayments).where(eq(schema.relayPayments.provider, addr))
    if (res2.length == 1) {
        cuSum = res2[0].cuSum
        relaySum = res2[0].relaySum
        rewardSum = res2[0].rewardSum
    }

    //
    const res3 = await db.select().from(schema.events).where(eq(schema.events.provider, addr))
    return {
        addr: provider.address,
        moniker: provider.moniker,
        cuSum: cuSum,
        relaySum: relaySum,
        rewardSum: rewardSum,
        events: res3,
    }
})

const consumerOpts: RouteShorthandOptions = {
    schema: {
        response: {
            200: {
                type: 'object',
                properties: {
                    addr: {
                        type: 'string'
                    },
                    cuSum: {
                        type: 'number'
                    },
                    relaySum: {
                        type: 'number'
                    },
                    rewardSum: {
                        type: 'number'
                    },
                    conflicts: {
                        type: 'array'
                    },
                    subsBuy: {
                        type: 'array'
                    }
                }
            }
        }
    }
}

server.get('/consumer/:addr', consumerOpts, async (request, reply) => {
    const { addr } = request.params as { addr: string }
    if (addr.length != 44) {
        return {} // TODO: errors
    }
    if (!addr.startsWith('lava@')) {
        return {} // TODO: errors
    }

    //
    const res = await db.select().from(schema.consumers).where(eq(schema.consumers.address, addr))
    if (res.length != 1) {
        return {} // TODO: errors
    }

    //
    let cuSum = 0
    let relaySum = 0
    let rewardSum = 0
    const res2 = await db.select({
        cuSum: sql<number>`sum(${schema.relayPayments.cu})`,
        relaySum: sql<number>`sum(${schema.relayPayments.relays})`,
        rewardSum: sql<number>`sum(${schema.relayPayments.pay})`
    }).from(schema.relayPayments).where(eq(schema.relayPayments.consumer, addr))
    if (res2.length == 1) {
        cuSum = res2[0].cuSum
        relaySum = res2[0].relaySum
        rewardSum = res2[0].rewardSum
    }

    //
    const res3 = await db.select().from(schema.conflictResponses).where(eq(schema.conflictResponses.consumer, addr))
    const res4 = await db.select().from(schema.subscriptionBuys).where(eq(schema.subscriptionBuys.consumer, addr))
    return {
        addr: addr,
        cuSum: cuSum,
        relaySum: relaySum,
        rewardSum: rewardSum,
        conflicts: res3,
        subsBuy: res4,
    }
})

export const queryserver = async (): Promise<void> => {
    try {
        await server.listen({ port: 3000 })

        const address = server.server.address()
        const port = typeof address === 'string' ? address : address?.port

    } catch (err) {
        server.log.error(err)
        process.exit(1)
    }
}

queryserver()