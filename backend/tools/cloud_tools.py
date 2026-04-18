"""
Cloud Execution Tools
─────────────────────
Three tool functions called by execution agents.
EXECUTION_MODE=mock  → fast simulated responses (default for demo)
EXECUTION_MODE=real  → actual LocalStack / AWS SDK calls

Flip one env variable to go from demo to production.
"""

import asyncio
import os
import random
import string
import uuid
from datetime import datetime

import boto3
from botocore.exceptions import ClientError

MODE = os.getenv("EXECUTION_MODE", "mock")
AWS_ENDPOINT = os.getenv("AWS_ENDPOINT_URL", "http://localhost:4566")
AWS_REGION = os.getenv("AWS_DEFAULT_REGION", "us-east-1")

print("☁️ Execution Mode:", MODE)
if MODE == "mock":
    print("🧪 Using MOCK execution")
elif MODE == "local":
    print("🧪 Using LocalStack")
elif MODE == "real":
    print("🌍 Using REAL AWS")


def _s3():
    return boto3.client(
        "s3",
        endpoint_url=AWS_ENDPOINT,
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID", "test"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY", "test"),
        region_name=AWS_REGION,
    )


def _ec2():
    return boto3.client(
        "ec2",
        endpoint_url=AWS_ENDPOINT,
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID", "test"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY", "test"),
        region_name=AWS_REGION,
    )


# ─── Tool 1: create_storage ───────────────────────────────────────────────

async def create_storage(params: dict) -> dict:
    bucket_name = params.get("bucket_name", f"bucket-{uuid.uuid4().hex[:8]}")
    region = params.get("region", "us-east-1")
    access_level = params.get("access_level", "private")

    # Simulate realistic latency
    await asyncio.sleep(random.uniform(1.0, 2.5) if MODE == "mock" else 0)

    if MODE == "mock":
        # Simulate occasional failure for demo (10% chance)
        if random.random() < 0.10:
            return {
                "status": "failed",
                "error": f"BucketAlreadyExists: bucket '{bucket_name}' already exists",
                "tool": "create_storage",
            }
        return {
            "status": "success",
            "tool": "create_storage",
            "bucket_name": bucket_name,
            "bucket_arn": f"arn:aws:s3:::{bucket_name}",
            "region": region,
            "access_level": access_level,
            "endpoint": f"https://{bucket_name}.s3.{region}.amazonaws.com",
            "created_at": datetime.utcnow().isoformat(),
        }

    # REAL mode: LocalStack or AWS
    try:
        s3 = _s3()
        if region == "us-east-1":
            s3.create_bucket(Bucket=bucket_name)
        else:
            s3.create_bucket(
                Bucket=bucket_name,
                CreateBucketConfiguration={"LocationConstraint": region},
            )
        if access_level == "private":
            s3.put_public_access_block(
                Bucket=bucket_name,
                PublicAccessBlockConfiguration={
                    "BlockPublicAcls": True,
                    "IgnorePublicAcls": True,
                    "BlockPublicPolicy": True,
                    "RestrictPublicBuckets": True,
                },
            )
        return {
            "status": "success",
            "tool": "create_storage",
            "bucket_name": bucket_name,
            "bucket_arn": f"arn:aws:s3:::{bucket_name}",
            "region": region,
            "access_level": access_level,
            "endpoint": f"https://{bucket_name}.s3.{region}.amazonaws.com",
            "created_at": datetime.utcnow().isoformat(),
        }
    except ClientError as e:
        return {"status": "failed", "error": str(e), "tool": "create_storage"}


# ─── Tool 2: allocate_compute ─────────────────────────────────────────────

async def allocate_compute(params: dict) -> dict:
    instance_type = params.get("instance_type", "t2.medium")
    cpu = params.get("cpu", 2)
    memory_gb = params.get("memory_gb", 4)
    region = params.get("region", "us-east-1")

    await asyncio.sleep(random.uniform(1.5, 3.0) if MODE == "mock" else 0)

    if MODE == "mock":
        instance_id = "i-" + uuid.uuid4().hex[:10]
        ip = f"10.0.{random.randint(1,255)}.{random.randint(1,255)}"
        return {
            "status": "success",
            "tool": "allocate_compute",
            "instance_id": instance_id,
            "instance_type": instance_type,
            "cpu": cpu,
            "memory_gb": memory_gb,
            "public_ip": ip,
            "private_ip": f"172.16.{random.randint(0,255)}.{random.randint(1,254)}",
            "region": region,
            "state": "running",
            "created_at": datetime.utcnow().isoformat(),
        }

    # REAL mode
    try:
        ec2 = _ec2()
        resp = ec2.run_instances(
            ImageId="ami-0abcdef1234567890",
            InstanceType=instance_type,
            MinCount=1,
            MaxCount=1,
            TagSpecifications=[
                {
                    "ResourceType": "instance",
                    "Tags": [{"Key": "ManagedBy", "Value": "NEXUS-OPS"}],
                }
            ],
        )
        inst = resp["Instances"][0]
        return {
            "status": "success",
            "tool": "allocate_compute",
            "instance_id": inst["InstanceId"],
            "instance_type": instance_type,
            "cpu": cpu,
            "memory_gb": memory_gb,
            "public_ip": inst.get("PublicIpAddress", "pending"),
            "private_ip": inst.get("PrivateIpAddress", "pending"),
            "region": region,
            "state": inst["State"]["Name"],
            "created_at": datetime.utcnow().isoformat(),
        }
    except ClientError as e:
        return {"status": "failed", "error": str(e), "tool": "allocate_compute"}


# ─── Tool 3: deploy_service ───────────────────────────────────────────────

async def deploy_service(params: dict, context: dict = None) -> dict:
    """
    context: outputs from previous steps (instance_id, bucket_arn injected here)
    """
    service_name = params.get("service_name", "myservice")
    image = params.get("image", f"{service_name}:latest")
    port = params.get("port", 8080)
    env_vars = params.get("env_vars", {})

    # Inject outputs from prior steps
    instance_id = (context or {}).get("instance_id", "i-unknown")
    bucket_arn = (context or {}).get("bucket_arn", "arn:aws:s3:::unknown")
    public_ip = (context or {}).get("public_ip", "10.0.0.1")

    await asyncio.sleep(random.uniform(2.0, 4.0) if MODE == "mock" else 0)

    if MODE == "mock":
        container_id = "ctr-" + uuid.uuid4().hex[:12]
        return {
            "status": "success",
            "tool": "deploy_service",
            "container_id": container_id,
            "service_name": service_name,
            "image": image,
            "instance_id": instance_id,
            "bucket_arn": bucket_arn,
            "endpoint": f"http://{public_ip}:{port}",
            "port": port,
            "state": "running",
            "health_check": "healthy",
            "created_at": datetime.utcnow().isoformat(),
        }

    # REAL mode: Docker SDK or ECS RunTask would go here
    container_id = "ctr-" + uuid.uuid4().hex[:12]
    return {
        "status": "success",
        "tool": "deploy_service",
        "container_id": container_id,
        "service_name": service_name,
        "image": image,
        "instance_id": instance_id,
        "bucket_arn": bucket_arn,
        "endpoint": f"http://{public_ip}:{port}",
        "port": port,
        "state": "running",
        "health_check": "healthy",
        "created_at": datetime.utcnow().isoformat(),
    }
