#!/usr/bin/env python3
"""
Stage 1: Backend Validation Test Suite

Tests all critical backend endpoints and functionality:
- Health check
- Camera CRUD operations
- Video asset operations
- Search functionality
- Audit logging
"""

import sys
import httpx
import json
from datetime import datetime, timezone
from typing import Optional

BASE_URL = "http://127.0.0.1:8000/api/v1"
CLIENT = httpx.Client(timeout=30.0)

class Colors:
    GREEN = "\033[92m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    BLUE = "\033[94m"
    RESET = "\033[0m"
    BOLD = "\033[1m"

def print_result(test_name: str, passed: bool, message: str = ""):
    status = f"{Colors.GREEN}[PASS]{Colors.RESET}" if passed else f"{Colors.RED}[FAIL]{Colors.RESET}"
    msg = f" - {message}" if message else ""
    print(f"{status} {test_name}{msg}")

def test_health():
    """Test /health endpoint"""
    try:
        response = CLIENT.get("http://127.0.0.1:8000/health")
        passed = response.status_code == 200
        print_result("Health Check", passed, f"Status: {response.status_code}")
        if passed and response.text:
            print(f"  Response: {response.text[:100]}")
        return passed
    except Exception as e:
        print_result("Health Check", False, str(e))
        return False

def test_camera_list():
    """Test GET /cameras"""
    try:
        response = CLIENT.get(f"{BASE_URL}/cameras")
        passed = response.status_code == 200 and isinstance(response.json(), list)
        cameras = response.json() if passed else []
        print_result("List Cameras", passed, f"Found {len(cameras)} cameras")
        return passed, cameras
    except Exception as e:
        print_result("List Cameras", False, str(e))
        return False, []

def test_camera_create():
    """Test POST /cameras to create a test camera"""
    try:
        import time
        unique_id = f"TEST_CAM_{int(time.time() % 100000)}"
        camera_data = {
            "camera_id": unique_id,
            "name": "Test Camera 1",
            "latitude": 21.1458,
            "longitude": 79.0882,
            "corridor_group": "Main Corridor",
            "status": "active"
        }
        response = CLIENT.post(f"{BASE_URL}/cameras", json=camera_data)
        passed = response.status_code in [200, 201]
        print_result("Create Camera", passed, f"Status: {response.status_code}")
        if passed:
            print(f"  Camera ID: {camera_data['camera_id']}")
        return passed, camera_data["camera_id"]
    except Exception as e:
        print_result("Create Camera", False, str(e))
        return False, None

def test_videos_list():
    """Test GET /videos"""
    try:
        response = CLIENT.get(f"{BASE_URL}/videos")
        passed = response.status_code == 200 and isinstance(response.json(), list)
        videos = response.json() if passed else []
        print_result("List Videos", passed, f"Found {len(videos)} videos")
        return passed, videos
    except Exception as e:
        print_result("List Videos", False, str(e))
        return False, []

def test_models_list():
    """Test GET /models"""
    try:
        response = CLIENT.get(f"{BASE_URL}/models")
        passed = response.status_code == 200 and isinstance(response.json(), list)
        models = response.json() if passed else []
        print_result("List Models", passed, f"Found {len(models)} models")
        return passed, models
    except Exception as e:
        print_result("List Models", False, str(e))
        return False, []

def test_search_logs():
    """Test GET /search/logs"""
    try:
        response = CLIENT.get(f"{BASE_URL}/search/logs")
        passed = response.status_code == 200 and isinstance(response.json(), list)
        logs = response.json() if passed else []
        print_result("Get Search Logs", passed, f"Found {len(logs)} log entries")
        return passed, logs
    except Exception as e:
        print_result("Get Search Logs", False, str(e))
        return False, []

def test_search_query(query_text: str = "person walking"):
    """Test POST /search with a query"""
    try:
        search_payload = {
            "query": query_text,
            "camera_ids": None,
            "time_start": None,
            "time_end": None,
            "object_type": "all",
            "top_k": 10
        }
        response = CLIENT.post(f"{BASE_URL}/search", json=search_payload)
        passed = response.status_code == 200 and isinstance(response.json(), list)
        results = response.json() if passed else []
        print_result("Search Query", passed, f"Found {len(results)} results for '{query_text}'")
        if results:
            print(f"  Top result score: {results[0].get('score', 'N/A')}")
        return passed, results
    except Exception as e:
        print_result("Search Query", False, str(e))
        return False, []

def test_dashboard_metrics():
    """Test GET /metrics/dashboard"""
    try:
        response = CLIENT.get(f"{BASE_URL}/metrics/dashboard")
        passed = response.status_code == 200
        if passed:
            data = response.json()
            required_fields = ["total_cameras", "total_videos", "processed_videos", "pending_videos", "processing_videos", "failed_videos"]
            passed = all(field in data for field in required_fields)
            print_result("Dashboard Metrics", passed, f"{data['total_cameras']} cameras, {data['total_videos']} videos")
        else:
            print_result("Dashboard Metrics", False, f"Status: {response.status_code}")
        return passed
    except Exception as e:
        print_result("Dashboard Metrics", False, str(e))
        return False

def main():
    print(f"\n{Colors.BOLD}{Colors.BLUE}=========================================================={Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.BLUE}DRISHTI Backend - Stage 1 Validation Tests{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.BLUE}=========================================================={Colors.RESET}\n")

    # Check if server is running
    print(f"{Colors.YELLOW}Checking backend connectivity...{Colors.RESET}")
    try:
        response = CLIENT.get(f"{BASE_URL}/health", timeout=5.0)
        print(f"{Colors.GREEN}[OK] Backend is online!{Colors.RESET}\n")
    except Exception as e:
        print(f"{Colors.RED}[ERROR] Backend is not running!{Colors.RESET}")
        print(f"  Error: {e}")
        print(f"  Please start the backend with: cd backend && uvicorn app.main:app --reload")
        return 1

    passed_tests = 0
    total_tests = 0

    # Test 1: Health
    print(f"{Colors.BOLD}Basic Connectivity:{Colors.RESET}")
    total_tests += 1
    if test_health():
        passed_tests += 1
    print()

    # Test 2-4: Camera operations
    print(f"{Colors.BOLD}Camera Operations:{Colors.RESET}")
    total_tests += 1
    list_ok, existing_cameras = test_camera_list()
    if list_ok:
        passed_tests += 1

    total_tests += 1
    create_ok, new_camera_id = test_camera_create()
    if create_ok:
        passed_tests += 1
    print()

    # Test 5: Videos
    print(f"{Colors.BOLD}Video Management:{Colors.RESET}")
    total_tests += 1
    if test_videos_list()[0]:
        passed_tests += 1
    print()

    # Test 6: Models
    print(f"{Colors.BOLD}Model Management:{Colors.RESET}")
    total_tests += 1
    if test_models_list()[0]:
        passed_tests += 1
    print()

    # Test 7-8: Search
    print(f"{Colors.BOLD}Search Functionality:{Colors.RESET}")
    total_tests += 1
    if test_search_logs()[0]:
        passed_tests += 1

    total_tests += 1
    if test_search_query()[0]:
        passed_tests += 1
    print()

    # Test 9: Metrics
    print(f"{Colors.BOLD}Dashboard Metrics:{Colors.RESET}")
    total_tests += 1
    if test_dashboard_metrics():
        passed_tests += 1
    print()

    # Summary
    print(f"{Colors.BOLD}{Colors.BLUE}=========================================================={Colors.RESET}")
    pass_rate = (passed_tests / total_tests * 100) if total_tests > 0 else 0
    status_color = Colors.GREEN if passed_tests == total_tests else Colors.YELLOW if pass_rate >= 75 else Colors.RED
    print(f"{Colors.BOLD}Summary: {status_color}{passed_tests}/{total_tests} tests passed ({pass_rate:.0f}%){Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.BLUE}=========================================================={Colors.RESET}\n")

    return 0 if passed_tests == total_tests else 1

if __name__ == "__main__":
    sys.exit(main())
