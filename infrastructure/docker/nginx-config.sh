#!/bin/sh
set -eu
# Docker embedded DNS and ECS/VPC DNS differ; use this task's actual resolver.
resolver="$(awk '/^nameserver/ {print $2; exit}' /etc/resolv.conf)"
upstream="${API_UPSTREAM:-http://api:3000}"
printf '%s' "$resolver" | grep -Eq '^[0-9.]+$' || { echo 'An IPv4 DNS resolver is required' >&2; exit 1; }
printf '%s' "$upstream" | grep -Eq '^https?://[A-Za-z0-9][A-Za-z0-9._-]*(:[0-9]{1,5})?$' || { echo 'Invalid API_UPSTREAM' >&2; exit 1; }
sed -e "s|__ASTERIQ_DNS_RESOLVER__|$resolver|g" -e "s|__ASTERIQ_API_UPSTREAM__|$upstream|g" \
  /etc/nginx/asteriq.conf.template > /etc/nginx/conf.d/default.conf
