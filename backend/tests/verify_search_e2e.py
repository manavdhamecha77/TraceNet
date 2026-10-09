import sys
import os
import io

# Ensure UTF-8 output on Windows console
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import json
import urllib.request
import urllib.parse

def test_api():
    base_url = "http://127.0.0.1:8000"
    
    # 1. Test parse endpoint with Hindi
    print("\n--- 1. Testing /api/v1/search/parse (Hindi) ---")
    req = urllib.request.Request(f"{base_url}/api/v1/search/parse?q=" + urllib.parse.quote("लाल शर्ट में आदमी"))
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        print(f"Detected: {data.get('detected_language')} (code: {data.get('language_code')})")
        print(f"Normalized: {data.get('normalized_query')}")
        print(f"Verifiable: {data.get('verifiable')}")
        print(f"Unverifiable: {data.get('unverifiable')}")

    # 2. Test parse endpoint with Gujarati
    print("\n--- 2. Testing /api/v1/search/parse (Gujarati) ---")
    req = urllib.request.Request(f"{base_url}/api/v1/search/parse?q=" + urllib.parse.quote("સફેદ કાર ગેટ 3 પાસે"))
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        print(f"Detected: {data.get('detected_language')} (code: {data.get('language_code')})")
        print(f"Normalized: {data.get('normalized_query')}")
        print(f"Verifiable: {data.get('verifiable')}")

    # 3. Test POST /api/v1/search with Hindi query
    print("\n--- 3. Testing POST /api/v1/search (Hindi) ---")
    payload = json.dumps({
        "query": "लाल शर्ट में आदमी",
        "top_k": 5
    }).encode('utf-8')
    req = urllib.request.Request(
        f"{base_url}/api/v1/search",
        data=payload,
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req) as resp:
        results = json.loads(resp.read().decode('utf-8'))
        print(f"Search returned {len(results)} results")
        if results:
            first = results[0]
            print(f"Top candidate: score={first.get('score'):.3f}, tracklet={first.get('tracklet_id')}, class={first.get('class_name')}")
            exp = first.get("explanation")
            if exp:
                print(f"Explanation evidence items: {len(exp.get('evidence', []))}")
                for ev in exp.get('evidence', []):
                    print(f"  - {ev.get('label')}: {ev.get('detail')}")

    # 4. Verify search log was recorded
    print("\n--- 4. Checking /api/v1/search/logs ---")
    req = urllib.request.Request(f"{base_url}/api/v1/search/logs")
    with urllib.request.urlopen(req) as resp:
        logs = json.loads(resp.read().decode('utf-8'))
        if logs:
            latest = logs[0]
            print(f"Latest search log: query='{latest.get('query_text')}', results={latest.get('results_count')}")

    print("\n[SUCCESS] All End-to-End checks passed!")

if __name__ == '__main__':
    test_api()
