
// src/query/handlers/providerErrors.ts

import path from 'path';
import { FastifyRequest, FastifyReply, RouteShorthandOptions } from 'fastify';
import { QueryCheckRelaysReadDbInstance, QueryGetRelaysReadDbInstance } from '../queryDb';
import { eq, desc } from "drizzle-orm";
import { Pagination } from '../utils/queryPagination';
import { CSVEscape, CompareValues } from '../utils/queryUtils';
import { JSINFO_QUERY_DEFAULT_ITEMS_PER_PAGE } from '../queryConsts';
import { ParseLavapProviderError } from '../utils/lavapProvidersErrorParser';
import * as RelaysSchema from '../../schemas/relays_schema';
import { CachedDiskPsqlQuery } from '../classes/CachedDiskPsqlQuery';
export interface ErrorsReport {
    id: number;
    created_at: Date | null;
    provider: string | null;
    spec_id: string | null;
    errors: string | null;
}

export interface ErrorsReportReponse {
    id: number;
    date: string;
    spec: string;
    error: string;
}

export const ProviderErrorsHandlerOpts: RouteShorthandOptions = {
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
                                id: { type: ['string', 'number'] },
                                date: { type: 'string' },
                                spec: { type: 'string' },
                                error: { type: 'string' },
                            }
                        }
                    }
                }
            }
        }
    }
}

class ProviderErrorsData extends CachedDiskPsqlQuery<ErrorsReportReponse> {
    private addr: string;


    constructor(addr: string) {
        super();
        this.addr = addr;
    }

    protected getCacheFilePath(): string {
        return path.join(this.cacheDir, `ProviderErrorsHandlerData_${this.addr}`);
    }

    protected async fetchDataFromDb(): Promise<ErrorsReportReponse[]> {
        const result = await QueryGetRelaysReadDbInstance().select().from(RelaysSchema.lavaReportError)
            .where(eq(RelaysSchema.lavaReportError.provider, this.addr))
            .orderBy(desc(RelaysSchema.lavaReportError.created_at)).offset(0).limit(5000)

        return result.map((row: ErrorsReport) => ({
            id: row.id,
            date: row.created_at?.toISOString() || '',
            spec: row.spec_id || '',
            error: ParseLavapProviderError(row.errors || ''),
        })).filter((report: ErrorsReportReponse) => report.date && report.error);
    }

    public async getPaginatedItemsImpl(data: ErrorsReportReponse[], pagination: Pagination | null): Promise<ErrorsReportReponse[] | null> {
        if (pagination == null) {
            return data.slice(0, JSINFO_QUERY_DEFAULT_ITEMS_PER_PAGE);
        }

        data = this.sortData(data, pagination.sortKey || "", pagination.direction);

        const start = (pagination.page - 1) * pagination.count;
        const end = start + pagination.count;

        // If slice would fail, return a [0,20] slice
        if (start < 0 || end < 0 || start > data.length || end > data.length) {
            return data.slice(0, JSINFO_QUERY_DEFAULT_ITEMS_PER_PAGE);
        }

        return data.slice(start, end);
    }

    private sortData(data: ErrorsReportReponse[], sortKey: string, direction: 'ascending' | 'descending'): ErrorsReportReponse[] {
        if (sortKey === "-" || sortKey === "") sortKey = "date";

        if (sortKey && ["date", "spec", "error"].includes(sortKey)) {
            if (sortKey !== "date" || direction !== "descending") {
                // default
            }
        } else {
            console.log(`Invalid sortKey: ${sortKey}`);
        }

        return data.sort((a, b) => {
            const aValue = a[sortKey];
            const bValue = b[sortKey];
            return CompareValues(aValue, bValue, direction);
        });
    }

    public async getCSVImpl(data: ErrorsReportReponse[]): Promise<string> {
        let csv = 'date,spec,error\n';
        data.forEach((item: ErrorsReportReponse) => {
            csv += `${item.date},${CSVEscape(item.spec)},${CSVEscape(item.error)}\n`;
        });
        return csv;
    }
}

export async function ProviderErrorsItemCountHandler(request: FastifyRequest, reply: FastifyReply) {
    await QueryCheckRelaysReadDbInstance()

    const { addr } = request.params as { addr: string }
    if (addr.length != 44 || !addr.startsWith('lava@')) {
        reply.code(400).send({ error: 'Bad provider address' });
        return reply;
    }

    const providerErrorsData = new ProviderErrorsData(addr);
    const count = await providerErrorsData.getTotalItemCount();

    return { itemCount: count };
}

export async function ProviderErrorsHandler(request: FastifyRequest, reply: FastifyReply) {
    await QueryCheckRelaysReadDbInstance()

    const { addr } = request.params as { addr: string }
    if (addr.length != 44 || !addr.startsWith('lava@')) {
        reply.code(400).send({ error: 'Bad provider address' });
        return reply;
    }

    const providerErrorsData = new ProviderErrorsData(addr);
    try {
        const data = await providerErrorsData.getPaginatedItems(request);
        return data;
    } catch (error) {
        const err = error as Error;
        reply.code(400).send({ error: String(err.message) });
    }
}

export async function ProviderErrorsCSVHandler(request: FastifyRequest, reply: FastifyReply) {
    await QueryCheckRelaysReadDbInstance()

    const { addr } = request.params as { addr: string }
    if (addr.length != 44 || !addr.startsWith('lava@')) {
        reply.code(400).send({ error: 'Bad provider address' });
        return reply;
    }

    const providerErrorsData = new ProviderErrorsData(addr);
    const csv = await providerErrorsData.getCSV();

    if (csv === null) {
        return;
    }

    reply.header('Content-Type', 'text/csv');
    reply.header('Content-Disposition', `attachment; filename=ProviderErrors_${addr}.csv`);
    reply.send(csv);
}