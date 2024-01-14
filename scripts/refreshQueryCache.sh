#!/bin/bash

# jsinfo/scripts/refreshQueryCache.sh

REST_URL="${REST_URL:-http://0.0.0.0:8080}"

get() {
    local url="$1"
    local retries=5
    local response=""
    echo "revalidate_cache: calling get on $REST_URL$url" >&2
    for ((i=0; i<$retries; i++)); do
        response=$(curl -s "$REST_URL$url")
        echo "$response"
        if echo "$response" | jq . > /dev/null 2>&1; then
            echo "$response"
            echo "$response" >&2
            return
        fi
        sleep 0.5
    done
}

revalidate_cache_for_specs() {
    echo "revalidate_cache: Revalidating cache for specs..."
    local response=$(get "/specs")
    local specs=$(echo "$response" | jq -r '.specs[] | .id')
    for spec in $specs; do
        echo "revalidate_cache: calling $REST_URL/spec/$spec"
        curl -s "$REST_URL/spec/$spec" > /dev/null
    done
}

revalidate_cache_for_consumers() {
    echo "revalidate_cache: Revalidating cache for consumers..."
    local response=$(get "/consumers")
    local consumers=$(echo "$response" | jq -r '.consumers[] | .address')
    for consumer in $consumers; do
        echo "revalidate_cache: calling $REST_URL/consumer/$consumer"
        curl -s "$REST_URL/consumer/$consumer" > /dev/null
    done
}

revalidate_cache_for_providers() {
    echo "revalidate_cache: Revalidating cache for providers..."
    local response=$(get "/providers")
    local providers=$(echo "$response" | jq -r '.providers[] | .address')
    for provider in $providers; do
        echo "revalidate_cache: calling $REST_URL/provider/$provider"
        curl -s "$REST_URL/provider/$provider" > /dev/null
    done
}

revalidate_cache() {
    echo "revalidate_cache: Starting revalidation of cache..."
    revalidate_cache_for_specs
    revalidate_cache_for_consumers
    revalidate_cache_for_providers
    echo "revalidate_cache: Finished revalidation of cache."
}

while true; do
    revalidate_cache
    sleep 30
done