import requests
import json

BASE_URL = "http://127.0.0.1:8000/api/v1/assistant"

def test_session_management():
    print("--- 1. Testing Session Creation (POST /sessions) ---")
    res_create = requests.post(f"{BASE_URL}/sessions", json={"title": "Test Session"})
    print(f"Create Status: {res_create.status_code}")
    sess = res_create.json()
    sess_id = sess.get("id")
    print("Created Session:", json.dumps(sess, indent=2))

    print("\n--- 2. Testing Chat with session_id ---")
    payload = {
        "session_id": sess_id,
        "messages": [
            {"role": "user", "content": "List all active smart city camera nodes"}
        ]
    }
    res_chat = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)
    print(f"Chat Status: {res_chat.status_code}")
    if res_chat.status_code == 200:
        chat_data = res_chat.json()
        print("Chat Response Title:", chat_data.get("session_title"))
        print("Chat Response Content Sample:", chat_data.get("content")[:100], "...")

    print("\n--- 3. Testing Sessions Listing (GET /sessions) ---")
    res_list = requests.get(f"{BASE_URL}/sessions")
    print(f"List Status: {res_list.status_code}")
    sessions_list = res_list.json()
    print(f"Total Saved Sessions: {len(sessions_list)}")

    print(f"\n--- 4. Testing Session Retrieval (GET /sessions/{sess_id}) ---")
    res_get = requests.get(f"{BASE_URL}/sessions/{sess_id}")
    print(f"Get Status: {res_get.status_code}")
    session_details = res_get.json()
    print("Session Message Count:", len(session_details.get("messages", [])))

    print(f"\n--- 5. Testing Session Deletion (DELETE /sessions/{sess_id}) ---")
    res_del = requests.delete(f"{BASE_URL}/sessions/{sess_id}")
    print(f"Delete Status: {res_del.status_code}")
    print(res_del.json())
    print("=" * 60 + "\n")

if __name__ == "__main__":
    test_session_management()
