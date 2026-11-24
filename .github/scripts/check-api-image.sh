#!/usr/bin/env bash
set -euo pipefail

image=$1
revision=$2

test "$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image")" = "$revision"
docker run --rm --network none --entrypoint node "$image" --use-openssl-ca --import tsx --input-type=module -e '
    import assert from "node:assert/strict";
    import { docsAssets } from "/app/packages/api/src/docs-assets.ts";
    assert.ok(docsAssets.version);
    assert.equal(process.env.SENTRY_RELEASE, process.argv[1]);
' "$revision"
