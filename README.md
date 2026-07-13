# TraceNet

**TraceNet** is an AI-driven descriptive search system for smart city CCTV footage. Instead of manually reviewing hours of video, investigators can search using natural language descriptions such as:

> *"Man in a red jacket carrying a black backpack near Gate 3 after 5 PM."*

The system retrieves the most relevant person or vehicle clips along with camera information, timestamps, confidence scores, and an explanation of why each result matched.

## Features (MVP)

* Natural language search over CCTV footage
* Person and vehicle retrieval
* Multi-camera video support
* CLIP-based semantic search
* FAISS vector indexing
* SQLite metadata storage
* Audit logging for every search
* Explainable search results
* Video clip playback

## Tech Stack

### Backend

* FastAPI
* SQLAlchemy
* SQLite
* OpenCV
* YOLOv8
* BMD-45
* ByteTrack
* CLIP
* FAISS

### Frontend

* React
* Vite
* TypeScript
* Tailwind CSS
* Axios

## Project Structure

```
backend/
frontend/
data/
docs/
AGENTS.md
```

## Getting Started

### Backend

```bash
cd backend

python -m venv .venv

# Windows
.venv\Scripts\activate

# Linux/macOS
source .venv/bin/activate

pip install -r requirements.txt

uvicorn app.main:app --reload
```

Backend API:

```
http://localhost:8000
```

Swagger Docs:

```
http://localhost:8000/docs
```

### Frontend

```bash
cd frontend

npm install

npm run dev
```
