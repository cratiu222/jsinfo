import * as lavajs from '@lavanet/lavajs';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type LavaClient = Awaited<ReturnType<typeof lavajs.lavanet.ClientFactory.createRPCQueryClient>>

export function GetOrSetProvider(
    dbProviders: Map<string, schema.Provider>,
    static_dbProviders: Map<string, schema.Provider> | null,
    address: string,
    moniker: string
): schema.Provider {
    if (static_dbProviders != null) {
        let staticProvider = static_dbProviders.get(address);
        if (staticProvider != undefined) {
            return staticProvider
        }
    }

    let provider = dbProviders.get(address);
    if ((provider != undefined) && ((provider.moniker != '') || ((provider.moniker == '') && (moniker == '')))) {
        return provider
    }

    provider = {
        address: address,
        moniker: moniker,
    } as schema.Provider
    dbProviders.set(address, provider)
    return provider
}

export function GetOrSetSpec(
    dbSpecs: Map<string, schema.Spec>,
    static_dbSpecs: Map<string, schema.Spec> | null,
    specS: string
): schema.Spec {
    if (static_dbSpecs != null) {
        let staticSpec = static_dbSpecs.get(specS);
        if (staticSpec != undefined) {
            return staticSpec
        }
    }

    let spec = dbSpecs.get(specS);
    if (spec != undefined) {
        return spec
    }

    spec = {
        id: specS
    } as schema.Spec
    dbSpecs.set(specS, spec)
    return spec
}

export function GetOrSetConsumer(
    dbConsumers: Map<string, schema.Consumer>,
    address: string
): schema.Consumer {
    let dbConsumer = dbConsumers.get(address);
    if (dbConsumer != undefined) {
        return dbConsumer
    }

    dbConsumer = {
        address: address
    } as schema.Consumer
    dbConsumers.set(address, dbConsumer)
    return dbConsumer
}

export function GetOrSetPlan(
    dbPlans: Map<string, schema.Plan>,
    static_dbPlans: Map<string, schema.Plan> | null,
    planId: string
): schema.Plan {
    if (static_dbPlans != null) {
        let staticPlan = static_dbPlans.get(planId);
        if (staticPlan != undefined) {
            return staticPlan
        }
    }

    let dbPlan = dbPlans.get(planId);
    if (dbPlan != undefined) {
        return dbPlan
    }

    dbPlan = {
        id: planId
    } as schema.Plan
    dbPlans.set(planId, dbPlan)
    return dbPlan
}

async function getLatestProvidersAndSpecs(
    client: LavaClient,
    dbProviders: Map<string, schema.Provider>,
    dbSpecs: Map<string, schema.Spec>,
) {
    const lavaClient = client.lavanet.lava;

    let specs = await lavaClient.spec.showAllChains()
    await Promise.all(specs.chainInfoList.map(async (spec) => {
        GetOrSetSpec(dbSpecs, null, spec.chainID)

        let providers = await lavaClient.pairing.providers({ chainID: spec.chainID, showFrozen: true })
        providers.stakeEntry.forEach((providerStake) => {
            GetOrSetProvider(dbProviders, null, providerStake.address, providerStake.moniker)
        })
    }))
}

async function getLatestPlans(client: LavaClient, dbPlans: Map<string, schema.Plan>) {
    const lavaClient = client.lavanet.lava;

    let plans = await lavaClient.plans.list()
    plans.plansInfo.forEach((plan) => {
        dbPlans.set(plan.index, {
            desc: plan.description,
            id: plan.index,
            price: parseInt(plan.price.amount),
        } as schema.Plan)
    })
}

export async function UpdateLatestBlockMeta(
    db: BetterSQLite3Database,
    client: LavaClient,
    static_dbProviders: Map<string, schema.Provider>,
    static_dbSpecs: Map<string, schema.Spec>,
    static_dbPlans: Map<string, schema.Plan>
) {
    await getLatestProvidersAndSpecs(client, static_dbProviders, static_dbSpecs)
    await getLatestPlans(client, static_dbPlans)
    await db.transaction(async (tx) => {
        //
        // Insert all specs
        const arrSpecs = Array.from(static_dbSpecs.values())
        if (arrSpecs.length > 0) {
            await tx.insert(schema.specs)
                .values(arrSpecs)
                .onConflictDoNothing();
        }

        //
        // Find our create all providers
        const arrProviders = Array.from(static_dbProviders.values())
        if (arrProviders.length > 0) {
            await tx.insert(schema.providers)
                .values(arrProviders)
                .onConflictDoNothing();
        }

        //
        // Find our create all plans
        const arrPlans = Array.from(static_dbPlans.values())
        if (arrPlans.length > 0) {
            await tx.insert(schema.plans)
                .values(arrPlans)
                .onConflictDoNothing();
        }
    })
}
