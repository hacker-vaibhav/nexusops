"""
InfraGenome routes.
"""

from fastapi import APIRouter, Depends, HTTPException, Query

from utils.genome_registry import list_genomes, get_genome, match_ticket
from utils.auth import require_user

router = APIRouter()


@router.get("/genomes/registry")
async def registry(limit: int = Query(default=20, ge=1, le=100), user: dict = Depends(require_user)):
    # Any authenticated user can inspect the registry.
    items = await list_genomes(limit=limit)
    return {
        "items": items,
        "count": len(items),
    }


@router.get("/genomes/registry/{genome_id}")
async def registry_item(genome_id: str, user: dict = Depends(require_user)):
    genome = await get_genome(genome_id)
    if not genome:
        raise HTTPException(status_code=404, detail="Genome not found")
    return genome


@router.get("/genomes/match")
async def genome_match(ticket: str = Query(..., min_length=3), user: dict = Depends(require_user)):
    return await match_ticket(ticket)
