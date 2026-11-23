#!/usr/bin/env bash
# Publishes WHL to OrcaCloud as version TAG (vX.Y.Z) with CHANGELOG (plain text) as its changelog.
#   publish.sh TAG WHL CHANGELOG
set -euo pipefail
tag="$1" whl="$2" changelog="$(cat "$3")"
api="${ORCACLOUD_API:-https://api.orcaslicer.com/api/v1/plugin-publish/releases}"
oidc_token="$(curl -sS -H "Authorization: Bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
  "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=orcacloud" | jq -r .value)"
metadata="$(jq -cn --arg version "${tag#v}" --arg changelog "$changelog" \
  '{version: $version} + (if $changelog == "" then {} else {changelog: $changelog} end)')"
status="$(curl -sS -o response.json -w '%{http_code}' \
  -H "Authorization: Bearer $oidc_token" \
  --form-string "metadata=$metadata" -F "files=@$whl" \
  "$api")"
cat response.json
echo
[ "$status" = "201" ]
