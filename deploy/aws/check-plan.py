#!/usr/bin/env python3
"""Refuse a first-deployment plan that mutates any existing managed resource."""
import json
import sys

plan = json.load(sys.stdin)
creates = []
for resource in plan.get("resource_changes", []):
    if resource.get("mode") == "data":
        continue
    actions = resource["change"]["actions"]
    if actions == ["no-op"]:
        continue
    if actions != ["create"]:
        raise SystemExit(f"STOP: {resource['address']} has actions {actions}; review exact targets")
    creates.append(resource["address"])
if not creates:
    raise SystemExit("No new resources to provision")
print(f"Creation-only plan: {len(creates)} new managed resources; no changes or deletes")
for address in creates:
    print(f"  {address}")
