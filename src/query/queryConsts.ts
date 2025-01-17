// src/query/consts.ts

import os from 'os';
import path from 'path';
import fs from 'fs';
import { GetEnvVar } from '../utils';

export const JSINFO_QUERY_IS_DEBUG_MODE: boolean = GetEnvVar("JSINFO_QUERY_IS_DEBUG_MODE", "false").toLowerCase() === "true";
export const JSINFO_QUERY_CACHE_ENABLED: boolean = GetEnvVar("JSINFO_QUERY_CACHE_ENABLED", "true").toLowerCase() === "true";
export const JSINFO_QUERY_CACHE_POPULTAE_MODE: boolean = GetEnvVar("JSINFO_QUERY_CACHE_POPULTAE_MODE", "false").toLowerCase() === "true";
export const JSINFO_QUERY_FASITY_PRINT_LOGS: boolean = GetEnvVar("JSINFO_QUERY_FASITY_PRINT_LOGS", "false").toLowerCase() === "true";
export const JSINGO_CACHED_DB_DATA_FETCHER_DEBUG: boolean = GetEnvVar("JSINGO_CACHED_DB_DATA_FETCHER_DEBUG", "false").toLowerCase() === "true";

export const JSINFO_QUERY_DISKCACHE = process.env.JSINFO_QUERY_DISKCACHE || "";
export const JSINFO_QUERY_CACHEDIR = JSINFO_QUERY_DISKCACHE && JSINFO_QUERY_DISKCACHE !== "" ? JSINFO_QUERY_DISKCACHE : path.join(os.tmpdir(), 'query-cache');

export const JSINFO_QUERY_CLEAR_DISKCACHE_ON_START: boolean = GetEnvVar("JSINFO_QUERY_CLEAR_DISKCACHE_ON_START", "false").toLowerCase() === "true";

fs.mkdirSync(JSINFO_QUERY_CACHEDIR, { recursive: true });

if (JSINFO_QUERY_CLEAR_DISKCACHE_ON_START) {
    fs.readdir(JSINFO_QUERY_CACHEDIR, (err, files) => {
        if (err) throw err;

        for (const file of files) {
            fs.unlink(path.join(JSINFO_QUERY_CACHEDIR, file), err => {
                if (err) throw err;
            });
        }
    });
}

const JSINFO_QUERY_PORT_STRING = process.env['JSINFO_QUERY_PORT']!;
if (!JSINFO_QUERY_PORT_STRING) {
    throw new Error('JSINFO_QUERY_PORT environment variable is not set or is an empty string');
}
export const JSINFO_QUERY_PORT = parseInt(JSINFO_QUERY_PORT_STRING);
export const JSINFO_QUERY_HOST = GetEnvVar('JSINFO_QUERY_HOST', '0.0.0.0');

// the lavapProviderHealthHandler endpoint is sending alot of data
export const JSINFO_QUERY_HIGH_POST_BODY_LIMIT = JSINFO_QUERY_CACHE_POPULTAE_MODE || JSINFO_QUERY_IS_DEBUG_MODE;
export const JSINFO_QUERY_LAVAP_DUAL_STACKING_DELEGATOR_REWARDS_ENDPOINT_ENABLED = JSINFO_QUERY_CACHE_POPULTAE_MODE || JSINFO_QUERY_IS_DEBUG_MODE;

// how many days back to store in the table
export const JSINFO_QUERY_PROVIDER_HEALTH_HOURLY_CUTOFF_DAYS = parseInt(GetEnvVar("JSINFO_QUERY_PROVIDER_HEALTH_HOURLY_CUTOFF_DAYS", "30"));
export const JSINFO_QUERY_PROVIDER_DUAL_STACKING_DELEGATOR_REWARDS_CUTOFF_DAYS = parseInt(GetEnvVar("JSINFO_QUERY_PROVIDER_DUAL_STACKING_DELEGATOR_REWARDS_CUTOFF_DAYS", "30"));

// how many items to show per page in the sorted table
export const JSINFO_QUERY_DEFAULT_ITEMS_PER_PAGE = parseInt(GetEnvVar("JSINFO_QUERY_DEFAULT_ITEMS_PER_PAGE", "20"));
export const JSINFO_QUERY_ALLOWED_ITEMS_PER_PAGE = parseInt(GetEnvVar("JSINFO_QUERY_ALLOWED_ITEMS_PER_PAGE", "100"));
export const JSINFO_QUERY_TOTAL_ITEM_LIMIT_FOR_PAGINATION = parseInt(GetEnvVar("JSINFO_QUERY_TOTAL_ITEM_LIMIT_FOR_PAGINATION", "5000"));

export const JSINFO_QUERY_HANDLER_CACHE_TIME_SECONDS = parseInt(GetEnvVar("JSINFO_QUERY_HANDLER_CACHE_TIME_SECONDS", (5 * 60 * 60) + "")); // 5 minutes
export const JSINFO_QUERY_HANDLER_CACHE_FETCH_LOCK_TIME_SECONDS = parseInt(GetEnvVar("JSINFO_QUERY_HANDLER_CACHE_FETCH_LOCK_TIME_SECONDS", (1 * 60 * 60) + "")); // 1 minute

export const JSINFO_NO_READ_DB = GetEnvVar("JSINFO_NO_READ_DB", "true").toLowerCase() === "true";

const numberQueryConsts = [
    'JSINFO_QUERY_PORT',
    'JSINFO_QUERY_PROVIDER_HEALTH_HOURLY_CUTOFF_DAYS',
    'JSINFO_QUERY_DEFAULT_ITEMS_PER_PAGE',
    'JSINFO_QUERY_ALLOWED_ITEMS_PER_PAGE',
    'JSINFO_QUERY_TOTAL_ITEM_LIMIT_FOR_PAGINATION',
    'JSINFO_QUERY_HANDLER_CACHE_TIME_SECONDS',
    'JSINFO_QUERY_HANDLER_CACHE_FETCH_LOCK_TIME_SECONDS'
];

numberQueryConsts.forEach(key => {
    if (Number.isNaN(global[key])) {
        throw new Error(`${key} is NaN`);
    }
});