"""
Caching layer for DRISHTI using in-memory cache with TTL support.
Provides caching for frequently accessed data like cameras, models, and search results.
"""
import time
from typing import Any, Optional, Dict, Callable
from datetime import datetime, timedelta
from functools import wraps
from loguru import logger


class CacheEntry:
    def __init__(self, value: Any, ttl_seconds: int):
        self.value = value
        self.created_at = time.time()
        self.ttl_seconds = ttl_seconds

    def is_expired(self) -> bool:
        return (time.time() - self.created_at) > self.ttl_seconds


class CacheManager:
    """In-memory cache with TTL support."""

    def __init__(self, max_size: int = 1000):
        self.cache: Dict[str, CacheEntry] = {}
        self.max_size = max_size
        self.hits = 0
        self.misses = 0

    def get(self, key: str) -> Optional[Any]:
        """Get value from cache if exists and not expired."""
        if key not in self.cache:
            self.misses += 1
            return None

        entry = self.cache[key]
        if entry.is_expired():
            del self.cache[key]
            self.misses += 1
            return None

        self.hits += 1
        return entry.value

    def set(self, key: str, value: Any, ttl_seconds: int = 300):
        """Set value in cache with TTL."""
        if len(self.cache) >= self.max_size:
            # Remove oldest entry
            oldest_key = min(self.cache.keys(), key=lambda k: self.cache[k].created_at)
            del self.cache[oldest_key]

        self.cache[key] = CacheEntry(value, ttl_seconds)

    def delete(self, key: str):
        """Delete entry from cache."""
        if key in self.cache:
            del self.cache[key]

    def clear(self):
        """Clear entire cache."""
        self.cache.clear()
        self.hits = 0
        self.misses = 0

    def get_stats(self) -> dict:
        """Get cache statistics."""
        total_requests = self.hits + self.misses
        hit_rate = (self.hits / total_requests * 100) if total_requests > 0 else 0

        return {
            "hits": self.hits,
            "misses": self.misses,
            "hit_rate_percent": round(hit_rate, 2),
            "size": len(self.cache),
            "max_size": self.max_size,
        }


# Global cache instance
_cache_manager = CacheManager()


def get_cache() -> CacheManager:
    """Get global cache manager instance."""
    return _cache_manager


def cache_result(ttl_seconds: int = 300, key_prefix: str = ""):
    """Decorator to cache function results."""
    def decorator(func: Callable):
        @wraps(func)
        def wrapper(*args, **kwargs):
            # Build cache key from function name, args, and kwargs
            cache_key = f"{key_prefix}:{func.__name__}"
            if args:
                cache_key += f":{':'.join(str(arg) for arg in args)}"
            if kwargs:
                cache_key += f":{':'.join(f'{k}={v}' for k, v in sorted(kwargs.items()))}"

            # Try to get from cache
            cached_value = _cache_manager.get(cache_key)
            if cached_value is not None:
                logger.debug(f"Cache hit for {cache_key}")
                return cached_value

            # Execute function
            result = func(*args, **kwargs)

            # Store in cache
            _cache_manager.set(cache_key, result, ttl_seconds)
            logger.debug(f"Cached result for {cache_key}")
            return result

        return wrapper
    return decorator
