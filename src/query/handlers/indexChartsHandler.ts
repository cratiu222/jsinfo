// src/query/handlers/indexChartsHandler.ts

import { FastifyReply, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { QueryCheckJsinfoReadDbInstance, QueryGetJsinfoReadDbInstance } from '../queryDb';
import * as JsinfoSchema from '../../schemas/jsinfoSchema';
import { sql, desc, gt, and, inArray, between, lt } from "drizzle-orm";
import { FormatDateItem } from '../utils/queryDateUtils';
import { CachedDiskDbDataFetcher } from '../classes/CachedDiskDbDataFetcher';
import path from 'path';

type CuRelayItem = {
    chainId: string;
    cuSum: number;
    relaySum: number;
};

type IndexChartResponse = {
    date: string;
    qos: number;
    data: CuRelayItem[];
};

interface CuRelayQueryData {
    date: string;
    chainId: string | null;
    cuSum: number;
    relaySum: number;
}

interface QosQueryData {
    // 2024-04-30T22:00:00.000Z
    date: string;
    qosSyncAvg: number;
    qosAvailabilityAvg: number;
    qosLatencyAvg: number;
    relaySum: number;
}

export const IndexChartsRawHandlerOpts: RouteShorthandOptions = {
    schema: {
        response: {
            200: {
                type: 'object',
                properties: {
                    data: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                date: { type: 'string' },
                                qos: { type: 'number' },
                                data: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            chainId: { type: 'string' },
                                            cuSum: { type: 'number' },
                                            relaySum: { type: 'number' },
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
};

class IndexChartsData extends CachedDiskDbDataFetcher<IndexChartResponse> {

    constructor() {
        super("IndexChartsData");
    }

    public static GetInstance(): IndexChartsData {
        return IndexChartsData.GetInstanceBase();
    }

    protected getCacheFilePath(): string {
        return path.join(this.cacheDir, `IndexChartsData`);
    }

    private async getTopChains(): Promise<string[]> {
        let sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        let topChainsQueryRes: { chainId: string | null; }[] = await QueryGetJsinfoReadDbInstance().select({
            chainId: JsinfoSchema.aggHourlyrelayPayments.specId,
        }).from(JsinfoSchema.aggHourlyrelayPayments).
            groupBy(sql`${JsinfoSchema.aggHourlyrelayPayments.specId}`).
            where(gt(sql<Date>`DATE(${JsinfoSchema.aggHourlyrelayPayments.datehour})`, sql<Date>`${sixMonthsAgo}`)).
            orderBy(desc(sql<number>`sum(${JsinfoSchema.aggHourlyrelayPayments.relaySum})`));

        const topChains: string[] = topChainsQueryRes
            .filter(chain => chain.chainId != null && chain.chainId.trim() !== '')
            .map(chain => chain.chainId as string)
            .slice(0, 10);

        if (topChains.length === 0 || topChainsQueryRes.length === 0) {
            console.warn('getTopChains empty data for topSpecs:: topChains:', topChains, 'topChainsQueryRes:', topChainsQueryRes);
        }

        this.log(`getTopChains result: ${JSON.stringify(topChains)}`);

        return topChains;
    }

    private addAllChains(mainChartData: CuRelayQueryData[]): CuRelayQueryData[] {
        const dateSums: Record<string, CuRelayQueryData> = {};

        for (const data of mainChartData) {
            const { date, cuSum, relaySum } = data;

            if (!date) {
                throw new Error('date is null or undefined');
            }

            if (!dateSums[date]) {
                dateSums[date] = { date, chainId: "All Chains", cuSum: 0, relaySum: 0 };
            }

            dateSums[date].cuSum += cuSum;
            dateSums[date].relaySum += relaySum;
        }

        const allChainsData: CuRelayQueryData[] = Object.values(dateSums);
        return [...mainChartData, ...allChainsData];
    }

    private async getMainChartData(topChains: any[]): Promise<CuRelayQueryData[]> {
        let mainChartData: CuRelayQueryData[] = []
        let currentDate = new Date();
        let sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        while (currentDate >= sixMonthsAgo) {
            let startDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
            let endDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

            let monthlyData: CuRelayQueryData[] = await QueryGetJsinfoReadDbInstance().select({
                date: sql<string>`DATE_TRUNC('day', ${JsinfoSchema.aggHourlyrelayPayments.datehour}) as mydate`,
                chainId: JsinfoSchema.aggHourlyrelayPayments.specId,
                cuSum: sql<number>`sum(COALESCE(${JsinfoSchema.aggHourlyrelayPayments.cuSum}, 0))`,
                relaySum: sql<number>`sum(COALESCE(${JsinfoSchema.aggHourlyrelayPayments.relaySum}, 0))`,
            }).from(JsinfoSchema.aggHourlyrelayPayments).
                where(
                    and(
                        and(
                            gt(sql<Date>`DATE(${JsinfoSchema.aggHourlyrelayPayments.datehour})`, sql<Date>`${startDate}`),
                            lt(sql<Date>`DATE(${JsinfoSchema.aggHourlyrelayPayments.datehour})`, sql<Date>`${endDate}`)
                        ),
                        inArray(JsinfoSchema.aggHourlyrelayPayments.specId, topChains)
                    )
                ).
                groupBy(sql`${JsinfoSchema.aggHourlyrelayPayments.specId}`, sql`mydate`).
                orderBy(sql`mydate`);

            // Verify and format the data
            monthlyData.forEach(item => {
                item.cuSum = Number(item.cuSum);
                item.relaySum = Number(item.relaySum);

                if (isNaN(Date.parse(item.date))) {
                    throw new Error(`Data format does not match the CuRelayQueryData interface. Item: ${JSON.stringify(item)}. Reason: item.date is not a valid date.`);
                } else if (isNaN(item.cuSum)) {
                    throw new Error(`Data format does not match the CuRelayQueryData interface. Item: ${JSON.stringify(item)}. Reason: item.cuSum is not a number.`);
                } else if (isNaN(item.relaySum)) {
                    throw new Error(`Data format does not match the CuRelayQueryData interface. Item: ${JSON.stringify(item)}. Reason: item.relaySum is not a number.`);
                }
            });

            mainChartData = mainChartData.concat(monthlyData);

            this.log(`getMainChartData:: Fetched data for month: ${currentDate.getMonth() + 1}-${currentDate.getFullYear()}`);
            currentDate.setMonth(currentDate.getMonth() - 1);
        }

        return this.addAllChains(mainChartData);
    }

    private async getQosData(): Promise<{ [key: string]: number }> {
        let currentDate = new Date();
        let sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        const qosDataFormatted: { [key: string]: number } = {};

        while (currentDate >= sixMonthsAgo) {
            let startDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
            let endDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0);

            let monthlyData: QosQueryData[] = await QueryGetJsinfoReadDbInstance().select({
                date: sql<string>`DATE_TRUNC('day', ${JsinfoSchema.aggHourlyrelayPayments.datehour}) as mydate`,
                qosSyncAvg: sql<number>`sum(case when ${JsinfoSchema.aggHourlyrelayPayments.qosSyncAvg} is not null and ${JsinfoSchema.aggHourlyrelayPayments.qosSyncAvg} != 0 then ${JsinfoSchema.aggHourlyrelayPayments.qosSyncAvg} else 0 end)`,
                qosAvailabilityAvg: sql<number>`sum(case when ${JsinfoSchema.aggHourlyrelayPayments.qosAvailabilityAvg} is not null and ${JsinfoSchema.aggHourlyrelayPayments.qosAvailabilityAvg} != 0 then ${JsinfoSchema.aggHourlyrelayPayments.qosAvailabilityAvg} else 0 end)`,
                qosLatencyAvg: sql<number>`sum(case when ${JsinfoSchema.aggHourlyrelayPayments.qosLatencyAvg} is not null and ${JsinfoSchema.aggHourlyrelayPayments.qosLatencyAvg} != 0 then ${JsinfoSchema.aggHourlyrelayPayments.qosLatencyAvg} else 0 end)`,
                relaySum: sql<number>`sum(case when ${JsinfoSchema.aggHourlyrelayPayments.relaySum} is not null and ${JsinfoSchema.aggHourlyrelayPayments.relaySum} != 0 then ${JsinfoSchema.aggHourlyrelayPayments.relaySum} else 0 end)`
            }).from(JsinfoSchema.aggHourlyrelayPayments).
                where(and(
                    gt(sql<Date>`DATE(${JsinfoSchema.aggHourlyrelayPayments.datehour})`, sql<Date>`${startDate}`),
                    lt(sql<Date>`DATE(${JsinfoSchema.aggHourlyrelayPayments.datehour})`, sql<Date>`${endDate}`)
                )).
                groupBy(sql`mydate`).
                orderBy(sql`mydate`);

            // Verify and format the data
            monthlyData.forEach(item => {
                item.qosSyncAvg = Number(item.qosSyncAvg);
                item.qosAvailabilityAvg = Number(item.qosAvailabilityAvg);
                item.qosLatencyAvg = Number(item.qosLatencyAvg);
                item.relaySum = Number(item.relaySum);

                if (isNaN(Date.parse(item.date))) {
                    throw new Error(`Data format does not match the QosQueryData interface. Item: ${JSON.stringify(item)}. Reason: item.date is not a valid date.`);
                } else if (isNaN(item.qosSyncAvg)) {
                    throw new Error(`Data format does not match the QosQueryData interface. Item: ${JSON.stringify(item)}. Reason: item.qosSyncAvg is not a number.`);
                } else if (isNaN(item.qosAvailabilityAvg)) {
                    throw new Error(`Data format does not match the QosQueryData interface. Item: ${JSON.stringify(item)}. Reason: item.qosAvailabilityAvg is not a number.`);
                } else if (isNaN(item.qosLatencyAvg)) {
                    throw new Error(`Data format does not match the QosQueryData interface. Item: ${JSON.stringify(item)}. Reason: item.qosLatencyAvg is not a number.`);
                } else if (isNaN(item.relaySum)) {
                    throw new Error(`Data format does not match the QosQueryData interface. Item: ${JSON.stringify(item)}. Reason: item.relaySum is not a number.`);
                }

                const qos = Math.cbrt(
                    (item.qosSyncAvg * item.relaySum) / item.relaySum *
                    (item.qosAvailabilityAvg * item.relaySum) / item.relaySum *
                    (item.qosLatencyAvg * item.relaySum) / item.relaySum
                );

                qosDataFormatted[item.date] = qos;
            });

            this.log(`getQosData:: Fetched data for month: ${currentDate.getMonth() + 1}-${currentDate.getFullYear()}`);
            currentDate.setMonth(currentDate.getMonth() - 1);
        }

        return qosDataFormatted;
    }


    private combineData(mainChartData: CuRelayQueryData[], qosDataFormatted: { [key: string]: number }): IndexChartResponse[] {
        // Group the mainChartData by date
        const groupedData: { [key: string]: CuRelayItem[] } = mainChartData.reduce((acc, item) => {
            if (!acc[item.date]) {
                acc[item.date] = [];
            }
            acc[item.date].push({
                chainId: item.chainId || '',
                cuSum: item.cuSum,
                relaySum: item.relaySum
            });
            return acc;
        }, {});

        // Merge the groupedData with qosDataFormatted
        return Object.keys(groupedData).map(date => {
            return {
                date: date,
                qos: qosDataFormatted[date] || 0,
                data: groupedData[date]
            };
        });
    }

    protected async fetchDataFromDb(): Promise<IndexChartResponse[]> {
        await QueryCheckJsinfoReadDbInstance()

        const topChains = await this.getTopChains();
        const mainChartData = await this.getMainChartData(topChains);
        const qosData = await this.getQosData();
        const combinedData = this.combineData(mainChartData, qosData);

        return combinedData;
    }

    protected async getItemsByFromToImpl(data: IndexChartResponse[], fromDate: Date, toDate: Date): Promise<IndexChartResponse[] | null> {
        console.log('Data before filtering:', JSON.stringify(data).substring(0, 1000));
        console.log('Filtering from date:', fromDate);
        console.log('Filtering to date:', toDate);

        const filteredData = data.filter(item => {
            const itemDate = new Date(item.date);
            console.log('Current item:', JSON.stringify(item).substring(0, 1000));
            return itemDate >= fromDate && itemDate <= toDate;
        });

        console.log('Data after filtering:', JSON.stringify(filteredData).substring(0, 1000));
        return filteredData;
    }
}

export async function IndexChartsRawHandler(request: FastifyRequest, reply: FastifyReply, debug = false) {
    if (debug) console.log('IndexChartsRawHandler:: Start');
    await QueryCheckJsinfoReadDbInstance();
    if (debug) console.log('IndexChartsRawHandler:: QueryCheckJsinfoReadDbInstance done');

    let ret: { data: IndexChartResponse[] } | null = await IndexChartsData.GetInstance().getItemsByFromToChartsHandler(request, reply);
    if (debug) console.log('IndexChartsRawHandler:: getItemsByFromToChartsHandler done');

    if (ret == null) {
        if (debug) console.log('IndexChartsRawHandler:: ret is null, returning reply');
        return reply;
    }

    const uniqueYears = new Set(ret.data.map(item => new Date(item.date).getFullYear()));
    if (debug) console.log(`IndexChartsRawHandler:: uniqueYears: ${Array.from(uniqueYears).join(', ')}`);

    const addYears = uniqueYears.size > 1;
    if (debug) console.log(`IndexChartsRawHandler:: addYears: ${addYears}`);

    let formattedData: IndexChartResponse[] = ret.data.map(item => {
        return {
            ...item,
            date: FormatDateItem(new Date(item.date), addYears)
        };
    });
    if (debug) console.log('IndexChartsRawHandler:: formattedData created');

    if (debug) console.log('IndexChartsRawHandler:: End');
    return reply.send({ data: formattedData });
}