import requests
import json
import base64
from PIL import Image
import io

BASE_URL = "http://127.0.0.1:8000/api/v1/assistant"

# Create a small dummy red image base64
img = Image.new("RGB", (100, 100), color="red")
buf = io.BytesIO()
img.save(buf, format="JPEG")
b64_str = base64.b64encode(buf.getvalue()).decode("utf-8")

def test_image_prompt():
    print("--- Testing Image + Text Prompt on Assistant ---")
    payload = {
        "messages": [
            {
                "role": "user",
                "content": "Find any person or vehicle matching this reference photo",
                "image_b64": b64_str
            }
        ]
    }
    try:
        res = requests.post(f"{BASE_URL}/chat", json=payload, timeout=90)
        print(f"Response Status Code: {res.status_code}")
        if res.status_code == 200:
            data = res.json()
            print("\n[AI Assistant Response]:")
            print(data.get("content"))
            print("\n[Executed Tools]:")
            print(json.dumps(data.get("executed_tools"), indent=2))
            print(f"\n[Attachments Count]: {len(data.get('attachments', []))}")
        else:
            print("Error response:", res.text)
    except Exception as e:
        print(f"Request exception: {e}")
    print("=" * 60 + "\n")

if __name__ == "__main__":
    test_image_prompt()
