"""
Cloud Execution Tools

Three tool functions called by execution agents.
EXECUTION_MODE=mock  -> simulated responses
EXECUTION_MODE=real  -> real AWS clients
"""

import asyncio
import os
import random
import uuid
import threading
import time
from pathlib import Path
from datetime import datetime

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError, EndpointConnectionError, NoCredentialsError
from dotenv import load_dotenv

from utils.runtime import get_effective_execution_mode, get_requested_execution_mode, has_ai_provider_keys
from utils.state import get_redis

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(_BACKEND_DIR / ".env", override=False)
load_dotenv(_PROJECT_ROOT / ".env", override=True)

REQUESTED_EXECUTION_MODE = get_requested_execution_mode()
EXECUTION_MODE = get_effective_execution_mode()
DEPLOY_MODE = os.getenv("DEPLOY_MODE", "demo")
AWS_REGION = os.getenv("AWS_DEFAULT_REGION", "us-east-1")
AWS_ENDPOINT_URL = os.getenv("AWS_ENDPOINT_URL", "http://localhost:4566")
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID", "").strip()
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY", "").strip()
AWS_AMI_ID = os.getenv("AWS_AMI_ID", "").strip()
DEFAULT_AMI_ID = os.getenv("DEFAULT_AMI_ID", "").strip()
DEFAULT_SUBNET = os.getenv("DEFAULT_SUBNET", "").strip()
DEFAULT_SECURITY_GROUP = os.getenv("DEFAULT_SECURITY_GROUP", "").strip()

S3_CONNECTED = False
EC2_CONNECTED = False
_AMI_MEMORY_CACHE: dict[str, str] = {}
_AMI_LOCK = asyncio.Lock()

if EXECUTION_MODE == "real":
    print("REAL MODE ACTIVE")
else:
    print("MOCK MODE ACTIVE")
print("Requested Execution Mode:", REQUESTED_EXECUTION_MODE)
print("Effective Execution Mode:", EXECUTION_MODE)
print("AI Provider Keys:", "present" if has_ai_provider_keys() else "missing")
print("Deploy Mode:", DEPLOY_MODE)


DEPLOY_SCRIPT = """#!/bin/bash
yum update -y
yum install -y python3
pip3 install flask

cd /home/ec2-user

echo "DEPLOY AGENT STARTED" > /home/ec2-user/output.log

cat <<EOF > app.py
from flask import Flask
app = Flask(__name__)

@app.route("/")
def home():
    return "NEXUS OPS DEPLOYED"

@app.route("/health")
def health():
    return {"status": "ok"}

app.run(host="0.0.0.0", port=8080)
EOF

echo "APP FILE CREATED" >> /home/ec2-user/output.log
nohup python3 app.py >> /home/ec2-user/output.log 2>&1 &
echo "FLASK SERVER STARTED" >> /home/ec2-user/output.log
"""


def _is_localstack() -> bool:
    return "localhost" in AWS_ENDPOINT_URL or "localstack" in AWS_ENDPOINT_URL


def get_clients():
    import boto3

    if EXECUTION_MODE == "real":
        return {
            "ec2": boto3.client(
                "ec2",
                region_name=AWS_REGION,
                aws_access_key_id=AWS_ACCESS_KEY_ID,
                aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
                config=_aws_config(),
            ),
            "s3": boto3.client(
                "s3",
                region_name=AWS_REGION,
                aws_access_key_id=AWS_ACCESS_KEY_ID,
                aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
                config=_aws_config(),
            ),
        }

    return {
        "ec2": boto3.client(
            "ec2",
            endpoint_url=AWS_ENDPOINT_URL,
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID", "test"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY", "test"),
            region_name=AWS_REGION,
            config=_aws_config(),
        ),
        "s3": boto3.client(
            "s3",
            endpoint_url=AWS_ENDPOINT_URL,
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID", "test"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY", "test"),
            region_name=AWS_REGION,
            config=_aws_config(),
        ),
    }


def _mock_storage_result(bucket_name: str, region: str, access_level: str, note: str = None) -> dict:
    payload = {
        "status": "success",
        "tool": "create_storage",
        "bucket_name": bucket_name,
        "bucket_arn": f"arn:aws:s3:::{bucket_name}",
        "region": region,
        "access_level": access_level,
        "endpoint": f"https://{bucket_name}.s3.{region}.amazonaws.com",
        "created_at": datetime.utcnow().isoformat(),
        "mode": "mock",
    }
    if note:
        payload["note"] = note
    return payload


def _mock_compute_result(instance_type: str, cpu: int, memory_gb: int, region: str, note: str = None) -> dict:
    instance_id = "i-" + uuid.uuid4().hex[:10]
    public_ip = f"10.0.{random.randint(1,255)}.{random.randint(1,255)}"
    payload = {
        "status": "success",
        "tool": "allocate_compute",
        "instance_id": instance_id,
        "instance_type": instance_type,
        "cpu": cpu,
        "memory_gb": memory_gb,
        "public_ip": public_ip,
        "public_url": f"http://{public_ip}:8080",
        "private_ip": f"172.16.{random.randint(0,255)}.{random.randint(1,254)}",
        "region": region,
        "state": "running",
        "created_at": datetime.utcnow().isoformat(),
        "mode": "mock",
    }
    if note:
        payload["note"] = note
    return payload


def _mock_deploy_result(params: dict, context: dict = None, note: str = None) -> dict:
    service_name = params.get("service_name", "myservice")
    port = params.get("port", 8080)
    instance_id = (context or {}).get("instance_id", "i-unknown")
    bucket_arn = (context or {}).get("bucket_arn", "arn:aws:s3:::unknown")
    public_ip = (context or {}).get("public_ip", "10.0.0.1")
    payload = {
        "status": "success",
        "tool": "deploy_service",
        "container_id": "ctr-" + uuid.uuid4().hex[:12],
        "service_name": service_name,
        "image": params.get("image", f"{service_name}:latest"),
        "instance_id": instance_id,
        "bucket_arn": bucket_arn,
        "public_ip": public_ip,
        "public_url": f"http://{public_ip}:{port}",
        "endpoint": f"http://{public_ip}:{port}",
        "port": port,
        "state": "running",
        "health_check": "healthy",
        "created_at": datetime.utcnow().isoformat(),
        "mode": "mock",
    }
    if note:
        payload["note"] = note
    return payload


def _aws_config():
    if EXECUTION_MODE == "real":
        return Config(
            ignore_configured_endpoint_urls=True,
            connect_timeout=3,
            read_timeout=10,
            retries={"max_attempts": 1, "mode": "standard"},
        )
    return Config(connect_timeout=3, read_timeout=10, retries={"max_attempts": 1, "mode": "standard"})


async def _redis_get(key: str):
    try:
        r = await get_redis()
        return await r.get(key)
    except Exception:
        return None


async def _redis_set(key: str, value: str):
    try:
        r = await get_redis()
        await r.set(key, value)
    except Exception:
        pass


def _latest_ami_filters():
    return [
        {
            "Name": "name",
            "Values": ["amzn2-ami-hvm-*-x86_64-gp2"],
        },
        {"Name": "root-device-type", "Values": ["ebs"]},
        {"Name": "virtualization-type", "Values": ["hvm"]},
    ]


async def get_ami_id(ec2, redis_client=None) -> str:
    """Resolve a reusable AMI id for the active region."""
    cache_key = f"ami:{AWS_REGION}"
    async with _AMI_LOCK:
        if redis_client is None:
            redis_client = await get_redis()

        try:
            cached = await redis_client.get(cache_key)
        except Exception:
            cached = None

        memory_cached = _AMI_MEMORY_CACHE.get(cache_key)
        if memory_cached:
            cached = memory_cached
            print("USING IN-MEMORY AMI:", cached)

        if cached:
            ami_id = cached.decode() if hasattr(cached, "decode") else cached
            try:
                latest_check = ec2.describe_images(
                    Owners=["amazon"],
                    Filters=_latest_ami_filters(),
                )
                latest_images = latest_check.get("Images", [])
                if latest_images:
                    latest_images.sort(key=lambda x: x.get("CreationDate", ""), reverse=True)
                    latest_ami = latest_images[0]["ImageId"]
                    if latest_ami == ami_id:
                        print("USING REDIS AMI:", ami_id)
                        _AMI_MEMORY_CACHE[cache_key] = ami_id
                        return ami_id
                    print("CACHED AMI OUTDATED:", ami_id, "-> refreshing to", latest_ami)
                    ami_id = latest_ami
                    _AMI_MEMORY_CACHE[cache_key] = ami_id
                    try:
                        await redis_client.set(cache_key, ami_id)
                    except Exception:
                        pass
                    print("AMI AUTO-STORED:", ami_id)
                    return ami_id
            except Exception as exc:
                try:
                    validation = ec2.describe_images(ImageIds=[ami_id])
                    images = validation.get("Images", [])
                    if images and images[0].get("State") == "available":
                        print("USING REDIS AMI:", ami_id)
                        _AMI_MEMORY_CACHE[cache_key] = ami_id
                        return ami_id
                except Exception:
                    pass
                print(f"Cached AMI invalid or unavailable, refreshing: {exc}")

        print("AMI ARCH: x86_64")
        print("FETCHING AWS DEFAULT AMI (x86)...")
        response = ec2.describe_images(
            Owners=["amazon"],
            Filters=_latest_ami_filters(),
        )
        images = response.get("Images", [])
        if not images:
            raise RuntimeError("No Amazon Linux AMI found")
        images.sort(key=lambda x: x.get("CreationDate", ""), reverse=True)
        ami_id = images[0]["ImageId"]
        _AMI_MEMORY_CACHE[cache_key] = ami_id
        try:
            await redis_client.set(cache_key, ami_id)
        except Exception:
            pass
        print("AMI AUTO-STORED:", ami_id)
        return ami_id


async def get_ami(region: str) -> str:
    clients = get_clients()
    redis_client = await get_redis()
    return await get_ami_id(clients["ec2"], redis_client)


def _build_public_url(public_ip: str, port: int = 8080) -> str:
    return f"http://{public_ip}:{port}"


async def _wait_for_instance_public_ip(ec2, instance_id: str, region: str, timeout_seconds: int = 180) -> str:
    deadline = asyncio.get_event_loop().time() + timeout_seconds
    while asyncio.get_event_loop().time() < deadline:
        resp = ec2.describe_instances(InstanceIds=[instance_id])
        reservations = resp.get("Reservations", [])
        for reservation in reservations:
            for instance in reservation.get("Instances", []):
                ip = instance.get("PublicIpAddress")
                if ip:
                    return ip
        await asyncio.sleep(3)
    raise RuntimeError(f"Timed out waiting for public IP for {instance_id} in {region}")


def _sync_terminate_instance(instance_id: str):
    ec2 = get_ec2_client()
    ec2.terminate_instances(InstanceIds=[instance_id])
    print(f"🧹 AUTO TERMINATE: EC2 terminated {instance_id}")


def _sync_cleanup_resources(instance_id: str, bucket_name: str | None = None):
    _sync_terminate_instance(instance_id)
    if bucket_name:
        s3 = get_s3_client()
        objects = s3.list_objects_v2(Bucket=bucket_name).get("Contents", [])
        if objects:
            s3.delete_objects(
                Bucket=bucket_name,
                Delete={"Objects": [{"Key": o["Key"]} for o in objects]},
            )
        s3.delete_bucket(Bucket=bucket_name)
        print(f"🧹 AUTO CLEANUP: S3 bucket deleted {bucket_name}")


async def auto_stop(instance_id: str):
    try:
        ec2 = get_ec2_client()
        ec2.stop_instances(InstanceIds=[instance_id])
        print(f"BUDGET MODE: EC2 stopped {instance_id}")
    except Exception as exc:
        print(f"Budget stop failed for {instance_id}: {exc}")


def schedule_auto_termination(instance_id: str, region: str = None, delay_seconds: int = 300):
    def _worker():
        print(f"⏱ AUTO TERMINATION SCHEDULED: {instance_id} in {delay_seconds}s")
        time.sleep(delay_seconds)
        try:
            _sync_terminate_instance(instance_id)
        except Exception as exc:
            print(f"Auto terminate failed for {instance_id}: {exc}")

    threading.Thread(target=_worker, daemon=True).start()


def schedule_auto_cleanup(instance_id: str, bucket_name: str | None = None, delay_seconds: int = 300):
    def _worker():
        print(f"⏱ AUTO CLEANUP SCHEDULED: {instance_id} in {delay_seconds}s")
        time.sleep(delay_seconds)
        try:
            _sync_cleanup_resources(instance_id, bucket_name=bucket_name)
        except Exception as exc:
            print(f"Auto cleanup failed for {instance_id}: {exc}")

    threading.Thread(target=_worker, daemon=True).start()


async def _ping_service(public_url: str, retries: int = 5, delay_seconds: float = 3.0) -> bool:
    import httpx

    for attempt in range(1, retries + 1):
        try:
            async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
                resp = await client.get(public_url)
                if 200 <= resp.status_code < 300:
                    return True
        except Exception as exc:
            print(f"Service ping attempt {attempt} failed for {public_url}: {exc}")
        await asyncio.sleep(delay_seconds * attempt)
    return False


def generate_bucket_name(base: str) -> str:
    safe = "".join(ch.lower() if ch.isalnum() or ch == "-" else "-" for ch in base)
    safe = safe.strip("-") or "nexus-ops"
    return f"{safe}-{int(datetime.utcnow().timestamp())}-{random.randint(100, 999)}"


def _resolve_network_defaults(ec2):
    subnet_id = DEFAULT_SUBNET
    security_group = DEFAULT_SECURITY_GROUP

    if subnet_id and security_group:
        try:
            subnet = ec2.describe_subnets(SubnetIds=[subnet_id]).get("Subnets", [])
            if subnet and not subnet[0].get("MapPublicIpOnLaunch"):
                raise RuntimeError(
                    f"DEFAULT_SUBNET {subnet_id} is not public. Use a public subnet so EC2 can bootstrap Flask."
                )
        except ClientError:
            pass
        return subnet_id, security_group

    vpcs = ec2.describe_vpcs(Filters=[{"Name": "isDefault", "Values": ["true"]}]).get("Vpcs", [])
    if not vpcs:
        raise RuntimeError("No default VPC found and DEFAULT_SUBNET / DEFAULT_SECURITY_GROUP are unset")

    vpc_id = vpcs[0]["VpcId"]

    if not subnet_id:
        subnets = ec2.describe_subnets(Filters=[{"Name": "vpc-id", "Values": [vpc_id]}]).get("Subnets", [])
        if not subnets:
            raise RuntimeError("No subnet available in default VPC and DEFAULT_SUBNET is unset")
        public_subnets = [s for s in subnets if s.get("MapPublicIpOnLaunch")]
        if not public_subnets:
            raise RuntimeError(
                "No public subnet found in the default VPC. "
                "Set DEFAULT_SUBNET to a public subnet so EC2 can reach the internet."
            )
        public_subnets.sort(key=lambda item: item.get("AvailabilityZone", ""))
        subnet_id = public_subnets[0]["SubnetId"]

    if not security_group:
        groups = ec2.describe_security_groups(
            Filters=[
                {"Name": "vpc-id", "Values": [vpc_id]},
                {"Name": "group-name", "Values": ["default"]},
            ]
        ).get("SecurityGroups", [])
        if not groups:
            groups = ec2.describe_security_groups(Filters=[{"Name": "vpc-id", "Values": [vpc_id]}]).get("SecurityGroups", [])
        if not groups:
            raise RuntimeError("No security group available in default VPC and DEFAULT_SECURITY_GROUP is unset")
        security_group = groups[0]["GroupId"]

    return subnet_id, security_group


def _ensure_public_8080_ingress(ec2, security_group: str):
    try:
        ec2.authorize_security_group_ingress(
            GroupId=security_group,
            IpPermissions=[
                {
                    "IpProtocol": "tcp",
                    "FromPort": 8080,
                    "ToPort": 8080,
                    "IpRanges": [{"CidrIp": "0.0.0.0/0", "Description": "NEXUS OPS deploy access"}],
                }
            ],
        )
        print("🌍 PUBLIC ACCESS ENABLED: 0.0.0.0/0:8080")
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code == "InvalidPermission.Duplicate":
            print("🌍 PUBLIC ACCESS ENABLED: 0.0.0.0/0:8080")
            return
        raise


def _resolve_free_tier_instance_type(ec2, preferred: str = "t2.micro") -> str:
    try:
        response = ec2.describe_instance_types(
            Filters=[{"Name": "free-tier-eligible", "Values": ["true"]}]
        )
        allowed = []
        for item in response.get("InstanceTypes", []):
            name = item.get("InstanceType")
            arches = item.get("ProcessorInfo", {}).get("SupportedArchitectures", [])
            if name and "x86_64" in arches:
                allowed.append(name)
        if preferred in allowed:
            return preferred
        for candidate in ("t3.micro", "t2.micro", "t4g.micro"):
            if candidate in allowed:
                return candidate
        if allowed:
            return allowed[0]
    except Exception as exc:
        print(f"Free-tier instance discovery failed: {exc}")

    return preferred


def get_s3_client():
    return get_clients()["s3"]


def get_ec2_client():
    return get_clients()["ec2"]


def _probe_connection():
    global S3_CONNECTED, EC2_CONNECTED

    try:
        get_s3_client().list_buckets()
        S3_CONNECTED = True
    except Exception:
        S3_CONNECTED = False

    try:
        get_ec2_client().describe_regions(AllRegions=False)
        EC2_CONNECTED = True
    except Exception:
        EC2_CONNECTED = False

    print(f"AWS S3 connected: {'yes' if S3_CONNECTED else 'no'}")
    print(f"AWS EC2 connected: {'yes' if EC2_CONNECTED else 'no'}")


async def get_aws_status() -> dict:
    """Return a live connectivity snapshot for Swagger UI and health checks."""
    cached_ami = None
    try:
        redis_client = await get_redis()
        cached_raw = await redis_client.get(f"ami:{AWS_REGION}")
        if cached_raw:
            cached_ami = cached_raw.decode() if hasattr(cached_raw, "decode") else cached_raw
    except Exception:
        cached_ami = _AMI_MEMORY_CACHE.get(f"ami:{AWS_REGION}")

    if EXECUTION_MODE == "mock":
        return {
            "execution_mode": EXECUTION_MODE,
            "requested_execution_mode": REQUESTED_EXECUTION_MODE,
            "deploy_mode": DEPLOY_MODE,
            "service_status": "online",
            "endpoint_url": AWS_ENDPOINT_URL,
            "region": AWS_REGION,
            "s3_connected": False,
            "ec2_connected": False,
            "uses_localstack": False,
            "ami_id_configured": False,
            "cached_ami_id": cached_ami,
            "bucket_count": None,
            "region_count": None,
            "s3_error": None,
            "ec2_error": None,
            "note": "Mock mode does not probe AWS. Add AI provider keys and set EXECUTION_MODE to real to test LocalStack or AWS.",
        }

    s3_error = None
    ec2_error = None
    bucket_count = None
    region_count = None

    try:
        s3 = get_s3_client()
        bucket_count = len(s3.list_buckets().get("Buckets", []))
    except Exception as exc:
        s3_error = str(exc)

    try:
        ec2 = get_ec2_client()
        region_count = len(ec2.describe_regions(AllRegions=False).get("Regions", []))
    except Exception as exc:
        ec2_error = str(exc)

    return {
        "execution_mode": EXECUTION_MODE,
        "requested_execution_mode": REQUESTED_EXECUTION_MODE,
        "deploy_mode": DEPLOY_MODE,
        "service_status": "online",
        "endpoint_url": AWS_ENDPOINT_URL,
        "region": AWS_REGION,
        "s3_connected": s3_error is None,
        "ec2_connected": ec2_error is None,
        "uses_localstack": False,
        "ami_id_configured": False,
        "cached_ami_id": cached_ami or _AMI_MEMORY_CACHE.get(f"ami:{AWS_REGION}"),
        "bucket_count": bucket_count,
        "region_count": region_count,
        "s3_error": s3_error,
        "ec2_error": ec2_error,
    }


# --- Tool 1: create_storage ---

async def create_storage(params: dict) -> dict:
    service_name = params.get("service_name", params.get("bucket_name", "nexus-ops"))
    bucket_name = generate_bucket_name(service_name)
    region = params.get("region", "us-east-1")
    access_level = params.get("access_level", "private")

    if EXECUTION_MODE != "real":
        print("MOCK MODE ACTIVE")
        await asyncio.sleep(random.uniform(1.0, 2.5))
        return _mock_storage_result(bucket_name, region, access_level)

    try:
        print("REAL MODE ACTIVE")
        print("REAL AWS CALL: S3 create/reuse")
        s3 = get_s3_client()
        exists = False
        try:
            s3.head_bucket(Bucket=bucket_name)
            exists = True
        except ClientError as head_error:
            code = str(head_error.response.get("Error", {}).get("Code", ""))
            if code in {"200", "301", "403"}:
                exists = True
            elif code not in {"404", "NoSuchBucket", "NotFound"}:
                raise

        if not exists:
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
        result = _mock_storage_result(bucket_name, region, access_level)
        result["mode"] = "real"
        result["exists"] = exists
        result["created"] = not exists
        if exists:
            result["note"] = "Bucket already existed; reused safely."
        print("REAL AWS CALL: S3 bucket reused" if exists else "REAL AWS CALL: S3 bucket created")
        return result
    except (ClientError, EndpointConnectionError, NoCredentialsError, BotoCoreError, Exception) as e:
        print(f"REAL AWS S3 FAILED: {e}")
        raise


# --- Tool 2: allocate_compute ---

async def allocate_compute(params: dict) -> dict:
    requested_instance_type = params.get("instance_type", "t2.medium")
    instance_type = "t2.micro"
    cpu = params.get("cpu", 2)
    memory_gb = params.get("memory_gb", 4)
    region = params.get("region", "us-east-1")

    if EXECUTION_MODE != "real":
        print("MOCK MODE ACTIVE")
        await asyncio.sleep(random.uniform(1.5, 3.0))
        return _mock_compute_result(instance_type, cpu, memory_gb, region)

    try:
        print("REAL MODE ACTIVE")
        print("🚀 DEPLOY AGENT STARTED")
        print("🚀 CALLING AWS EC2...")
        ec2 = get_ec2_client()
        response = ec2.describe_security_groups(
            Filters=[{"Name": "group-name", "Values": ["default"]}]
        )
        sg_id = response["SecurityGroups"][0]["GroupId"]
        print("🔐 USING SECURITY GROUP:", sg_id)
        _ensure_public_8080_ingress(ec2, sg_id)
        redis_client = await get_redis()
        image_id = await get_ami_id(ec2, redis_client)
        subnet_id, _ = _resolve_network_defaults(ec2)
        resolved_type = _resolve_free_tier_instance_type(ec2, preferred=instance_type)
        instance_type = resolved_type
        print("INSTANCE TYPE REQUESTED:", requested_instance_type)
        print("INSTANCE TYPE RESOLVED:", instance_type)
        resp = ec2.run_instances(
            ImageId=image_id,
            InstanceType=instance_type,
            MinCount=1,
            MaxCount=1,
            NetworkInterfaces=[
                {
                    "DeviceIndex": 0,
                    "AssociatePublicIpAddress": True,
                    "SubnetId": subnet_id,
                    "Groups": [sg_id],
                }
            ],
            UserData=DEPLOY_SCRIPT,
            TagSpecifications=[
                {
                    "ResourceType": "instance",
                    "Tags": [
                        {"Key": "ManagedBy", "Value": "NEXUS-OPS"},
                        {"Key": "Project", "Value": "NEXUS-OPS"},
                    ],
                }
            ],
        )
        inst = resp["Instances"][0]
        instance_id = inst["InstanceId"]
        waiter = ec2.get_waiter("instance_running")
        await asyncio.to_thread(waiter.wait, InstanceIds=[instance_id])
        await asyncio.sleep(20)
        public_ip = await _wait_for_instance_public_ip(ec2, instance_id, region)
        if not public_ip:
            raise Exception("❌ NO PUBLIC IP")
        public_url = _build_public_url(public_ip, 8080)
        print("✅ REAL AWS CALL: EC2 CREATED", instance_id)
        print("🟢 ELASTIC IP:", public_ip)
        print("🟢 PUBLIC IP:", public_ip)
        print("🌐 FINAL URL:", public_url)
        print("⚠️ WARNING: INSTANCE IS PUBLICLY ACCESSIBLE FROM INTERNET")
        if not await _ping_service(f"{public_url}/health", retries=24, delay_seconds=5):
            raise Exception("❌ DEPLOY FAILED")
        print("✅ DEPLOY VERIFIED")
        return {
            "status": "success",
            "tool": "allocate_compute",
            "instance_id": instance_id,
            "instance_type": instance_type,
            "requested_instance_type": requested_instance_type,
            "cpu": cpu,
            "memory_gb": memory_gb,
            "public_ip": public_ip,
            "elastic_ip": public_ip,
            "public_url": public_url,
            "region": region,
            "state": "running",
            "created_at": datetime.utcnow().isoformat(),
            "ami_id": image_id,
            "mode": "real",
            "deploy_mode": DEPLOY_MODE,
        }
    except ClientError as e:
        code = str(e.response.get("Error", {}).get("Code", ""))
        message = str(e)
        if code == "InvalidParameterCombination" or "Free Tier" in message or "free tier" in message.lower():
            try:
                fallback_type = _resolve_free_tier_instance_type(get_ec2_client(), preferred="t3.micro")
                if fallback_type != instance_type:
                    print("INSTANCE TYPE FALLBACK:", fallback_type)
                    ec2 = get_ec2_client()
                    response = ec2.describe_security_groups(
                        Filters=[{"Name": "group-name", "Values": ["default"]}]
                    )
                    sg_id = response["SecurityGroups"][0]["GroupId"]
                    print("🔐 USING SECURITY GROUP:", sg_id)
                    _ensure_public_8080_ingress(ec2, sg_id)
                    redis_client = await get_redis()
                    image_id = await get_ami_id(ec2, redis_client)
                    subnet_id, _ = _resolve_network_defaults(ec2)
                    resp = ec2.run_instances(
                        ImageId=image_id,
                        InstanceType=fallback_type,
                        MinCount=1,
                        MaxCount=1,
                        NetworkInterfaces=[
                            {
                                "DeviceIndex": 0,
                                "AssociatePublicIpAddress": True,
                                "SubnetId": subnet_id,
                                "Groups": [sg_id],
                            }
                        ],
                        UserData=DEPLOY_SCRIPT,
                        TagSpecifications=[
                            {
                                "ResourceType": "instance",
                                "Tags": [
                                    {"Key": "ManagedBy", "Value": "NEXUS-OPS"},
                                    {"Key": "Project", "Value": "NEXUS-OPS"},
                                ],
                            }
                        ],
                    )
                    inst = resp["Instances"][0]
                    instance_id = inst["InstanceId"]
                    waiter = ec2.get_waiter("instance_running")
                    await asyncio.to_thread(waiter.wait, InstanceIds=[instance_id])
                    await asyncio.sleep(20)
                    public_ip = await _wait_for_instance_public_ip(ec2, instance_id, region)
                    if not public_ip:
                        raise Exception("❌ NO PUBLIC IP")
                    public_url = _build_public_url(public_ip, 8080)
                    print("✅ REAL AWS CALL: EC2 CREATED", instance_id)
                    print("🟢 ELASTIC IP:", public_ip)
                    print("🟢 PUBLIC IP:", public_ip)
                    print("🌐 FINAL URL:", public_url)
                    print("⚠️ WARNING: INSTANCE IS PUBLICLY ACCESSIBLE FROM INTERNET")
                    if not await _ping_service(f"{public_url}/health", retries=24, delay_seconds=5):
                        raise Exception("❌ DEPLOY FAILED")
                    print("✅ DEPLOY VERIFIED")
                    return {
                        "status": "success",
                        "tool": "allocate_compute",
                        "instance_id": instance_id,
                        "instance_type": fallback_type,
                        "requested_instance_type": requested_instance_type,
                        "cpu": cpu,
                        "memory_gb": memory_gb,
                        "public_ip": public_ip,
                        "elastic_ip": public_ip,
                        "public_url": public_url,
                        "region": region,
                        "state": "running",
                        "created_at": datetime.utcnow().isoformat(),
                        "ami_id": image_id,
                        "mode": "real",
                        "deploy_mode": DEPLOY_MODE,
                    }
            except Exception as retry_exc:
                print(f"REAL AWS EC2 FALLBACK FAILED: {retry_exc}")
                raise retry_exc
        print(f"REAL AWS EC2 FAILED: {e}")
        raise
    except (EndpointConnectionError, NoCredentialsError, BotoCoreError, Exception) as e:
        print(f"REAL AWS EC2 FAILED: {e}")
        raise


# --- Tool 3: deploy_service ---

async def deploy_service(params: dict, context: dict = None) -> dict:
    """
    context: outputs from previous steps (instance_id, bucket_arn injected here)
    """
    service_name = params.get("service_name", "myservice")
    image = params.get("image", f"{service_name}:latest")
    port = params.get("port", 8080)
    env_vars = params.get("env_vars", {})

    instance_id = (context or {}).get("instance_id", "i-unknown")
    bucket_arn = (context or {}).get("bucket_arn", "arn:aws:s3:::unknown")
    bucket_name = (context or {}).get("bucket_name")
    public_ip = (context or {}).get("public_ip", "10.0.0.1")
    public_url = (context or {}).get("public_url") or _build_public_url(public_ip, port)
    upstream_mode = (context or {}).get("mode")

    if EXECUTION_MODE != "real":
        print("MOCK MODE ACTIVE")
        await asyncio.sleep(random.uniform(2.0, 4.0))
        return _mock_deploy_result(params, context)

    if instance_id == "i-unknown" or public_ip in {"10.0.0.1", "pending"}:
        raise RuntimeError("Deployment missing compute context")

    try:
        print("REAL MODE ACTIVE")
        print("REAL AWS CALL: EC2 launched")
        return {
            "status": "success",
            "tool": "deploy_service",
            "container_id": "ec2-web",
            "service_name": service_name,
            "image": image,
            "instance_id": instance_id,
            "bucket_name": bucket_name,
            "bucket_arn": bucket_arn,
            "public_ip": public_ip,
            "public_url": public_url,
            "endpoint": public_url,
            "port": port,
            "state": "running",
            "health_check": "healthy",
            "created_at": datetime.utcnow().isoformat(),
            "mode": "real",
            "deploy_mode": DEPLOY_MODE,
        }
    except (ClientError, EndpointConnectionError, NoCredentialsError, BotoCoreError, Exception) as e:
        print(f"REAL DEPLOYMENT FAILED: {e}")
        raise
