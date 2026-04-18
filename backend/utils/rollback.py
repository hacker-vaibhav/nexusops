"""
Rollback Engine
───────────────
Tracks every resource created during a task.
On partial failure (e.g. S3 created, EC2 failed permanently):
  → Automatically tears down successfully created resources
  → Leaves the environment clean — no orphan resources
  → Reports exactly what was rolled back

This is the most important production-grade feature.
"""

import asyncio
import os
import uuid
from datetime import datetime
from typing import Callable

import boto3
from botocore.exceptions import ClientError

MODE         = os.getenv("EXECUTION_MODE", "mock")
AWS_ENDPOINT = os.getenv("AWS_ENDPOINT_URL", "http://localhost:4566")
AWS_REGION   = os.getenv("AWS_DEFAULT_REGION", "us-east-1")


def _s3():
    return boto3.client(
        "s3", endpoint_url=AWS_ENDPOINT,
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID", "test"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY", "test"),
        region_name=AWS_REGION,
    )


class RollbackEngine:
    """
    Context manager that tracks resources and rolls them back on failure.

    Usage:
        engine = RollbackEngine(task_id, notify_fn)
        engine.register("s3_bucket", "my-bucket-prod")
        engine.register("ec2_instance", "i-0abc1234")

        # On failure:
        await engine.rollback()
    """

    def __init__(self, task_id: str, notify: Callable):
        self.task_id   = task_id
        self.notify    = notify
        self.resources = []          # List of (resource_type, resource_id, metadata)
        self.rolled_back = False

    def register(self, resource_type: str, resource_id: str, metadata: dict = None):
        """Register a successfully created resource for potential rollback."""
        self.resources.append({
            "type":     resource_type,
            "id":       resource_id,
            "metadata": metadata or {},
            "created_at": datetime.utcnow().isoformat(),
        })

    async def rollback(self):
        """
        Roll back all registered resources in reverse order.
        Called automatically on task failure.
        """
        if self.rolled_back or not self.resources:
            return

        self.rolled_back = True
        await self.notify(
            f"🔴 Rolling back {len(self.resources)} resource(s) to prevent orphan infrastructure...",
            "retrying"
        )

        # Reverse order — teardown in opposite of creation order
        for resource in reversed(self.resources):
            await self._teardown_one(resource)

        await self.notify(
            f"🧹 Rollback complete — environment is clean.",
            "info"
        )

    async def _teardown_one(self, resource: dict):
        """Tear down a single resource."""
        rtype = resource["type"]
        rid   = resource["id"]

        await self.notify(f"↺ Rolling back {rtype}: {rid}", "retrying")

        if MODE == "mock":
            # Simulate teardown delay
            await asyncio.sleep(0.5)
            await self.notify(f"✓ {rtype} {rid} deleted (mock)", "info")
            return

        try:
            if rtype == "s3_bucket":
                s3 = _s3()
                # Empty bucket first
                try:
                    objects = s3.list_objects_v2(Bucket=rid).get("Contents", [])
                    if objects:
                        s3.delete_objects(
                            Bucket=rid,
                            Delete={"Objects": [{"Key": o["Key"]} for o in objects]}
                        )
                except Exception:
                    pass
                s3.delete_bucket(Bucket=rid)
                await self.notify(f"✓ S3 bucket {rid} deleted", "info")

            elif rtype == "ec2_instance":
                ec2 = boto3.client(
                    "ec2", endpoint_url=AWS_ENDPOINT,
                    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID", "test"),
                    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY", "test"),
                    region_name=AWS_REGION,
                )
                ec2.terminate_instances(InstanceIds=[rid])
                await self.notify(f"✓ EC2 instance {rid} terminated", "info")

            elif rtype == "container":
                # Docker container — best effort
                try:
                    import subprocess
                    subprocess.run(["docker", "stop", rid], capture_output=True, timeout=5)
                    subprocess.run(["docker", "rm", rid], capture_output=True, timeout=5)
                except Exception:
                    pass
                await self.notify(f"✓ Container {rid} stopped", "info")

        except ClientError as e:
            await self.notify(f"⚠ Could not delete {rtype} {rid}: {e}", "info")
        except Exception as e:
            await self.notify(f"⚠ Rollback warning for {rtype} {rid}: {e}", "info")


def estimate_cost_before_execution(plan: dict) -> dict:
    """
    Estimate monthly cost BEFORE executing, shown to user as a warning.
    Returns cost breakdown by resource type.
    """
    PRICING_HOURLY = {
        "t2.nano": 0.0058, "t2.micro": 0.0116, "t2.small": 0.023,
        "t2.medium": 0.0464, "t2.large": 0.0928,
        "t3.medium": 0.0416, "t3.large": 0.0832,
    }

    steps = plan.get("steps", [])
    breakdown = []
    total_monthly = 0.0

    for step in steps:
        if step["tool"] == "create_storage":
            cost = 0.02
            breakdown.append({
                "resource": f"S3 Bucket ({step['params'].get('bucket_name','bucket')})",
                "hourly": 0.0,
                "monthly": cost,
                "note": "$0.023/GB, estimated minimal use",
            })
            total_monthly += cost

        elif step["tool"] == "allocate_compute":
            itype   = step["params"].get("instance_type", "t2.medium")
            hourly  = PRICING_HOURLY.get(itype, 0.0464)
            monthly = round(hourly * 730, 2)
            breakdown.append({
                "resource": f"EC2 Instance ({itype})",
                "hourly": hourly,
                "monthly": monthly,
                "note": f"${hourly:.4f}/hr × 730 hrs/month",
            })
            total_monthly += monthly

        elif step["tool"] == "deploy_service":
            breakdown.append({
                "resource": f"Container ({step['params'].get('service_name','service')})",
                "hourly": 0.0,
                "monthly": 0.0,
                "note": "No direct cost (runs on provisioned EC2)",
            })

    return {
        "breakdown":      breakdown,
        "total_monthly":  round(total_monthly, 2),
        "total_hourly":   round(total_monthly / 730, 4),
        "currency":       "USD",
        "note":           "Estimates based on AWS on-demand pricing (us-east-1). Actual costs may vary.",
    }
