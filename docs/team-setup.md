# Team Setup — after pulling the latest `main`

Read this once after pulling. It covers what changed for every machine: login is now required, data is
shared through S3, and models run on the GPU when one is available. Passwords are never written in this
repo; get yours privately from the Admin.

---

## 1. Install the new dependencies

From `backend/`:

```
pip install -r requirements.txt
```

New packages: `bcrypt` (login), `boto3` + `certifi` (S3).

## 2. Configure `backend/.env`

Copy `backend/.env.example` to `backend/.env` (git-ignored, never commit it) and fill in:

| Setting | Value |
|---|---|
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | shared S3 key (ask the Admin privately) |
| `AWS_REGION` | `ap-southeast-2` |
| `S3_BUCKET` | `tracenet-gama` |
| `AUTH_ENABLED` | `true` (default). `false` turns login off — local development only |
| `TRACENET_DEVICE` | `auto` (default: GPU if available, else CPU) |

## 3. Log in

Login is **on by default**. Every machine needs at least one account before the app can be used.

| Role | For |
|---|---|
| **Operator** | Investigation: search, uploads, alerts, hot targets, Journey Map, exports, reports, Copilot |
| **Admin** | Everything an Operator can do, plus users, ML models, cameras / areas, configuration, maintenance and permanent deletion |

Account commands (from `backend/`; passwords are prompted, never typed on the command line):

```
python -m app.auth.users add <username> --role operator --name "Name / Badge #1234"
python -m app.auth.users add <username> --role admin    --name "Name / Badge #1001"
python -m app.auth.users list
python -m app.auth.users passwd <username>       # change a password
python -m app.auth.users disable <username>      # and: enable <username>
python -m app.auth.users role <username> operator|admin
```

- **Change any password you received in chat** with `passwd` after your first login.
- **Disable accounts nobody uses.** The last active Admin cannot be disabled or demoted.
- Admins can also manage accounts through the API (`/api/v1/auth/users`). Details: `docs/auth-rbac.md`.

## 4. Shared data (S3)

**The golden machine** (the one with the complete, correct data) publishes; **everyone else pulls**.
Full guide: `docs/s3-sync.md`.

### Golden machine, before pushing

1. **Create the team's accounts first.** A pull replaces `drishti.db` on every other machine, *accounts
   included*: whatever accounts exist on the golden machine are the accounts everyone gets.
2. Fix data issues first. Known one: the Gopi Talav footage (`bf568a07…`) is assigned to **CAM_001
   (Chauta Bazar)** while CAM_002 is Gopi Talav. The same scene under two cameras can produce a fake
   cross-camera Journey Map route.
3. Re-process the videos that have no sightings, run the colour backfill, place the model weights
   (paths in `docs/s3-sync.md`), then, with the backend **stopped**:

```
python -m app.storage.sync push
```

### Everyone else

With the backend **stopped**:

```
python -m app.storage.sync pull --with-media
```

Use `--with-media`: the offline multilingual models (`models/translation_hi_en`, `models/multilingual_clip`)
are only downloaded this way — they are not fetched on demand. The LUMPI clips for the Fusion Replay
(`backend/data/evaluation/`) come with the snapshot.

## 5. GPU (NVIDIA)

Models use the GPU automatically when PyTorch can see it. Check:

```
python -c "from app.runtime.device import device_summary; print(device_summary())"
```

If it reports `cpu` and a `hint` about a CPU-only PyTorch build, install the CUDA build. For torch 2.13 on
Python 3.14 / Windows with an NVIDIA driver >= 560, this exact command was verified:

```
pip install --force-reinstall --no-deps torch==2.13.0 torchvision==0.28.0 --index-url https://download.pytorch.org/whl/cu126
```

(About 2.5 GB. On the RTX 4060 a 12-second clip went from ~100 s on CPU to ~37 s.)

### Assault detection model (once per machine)

The Assault page and the Copilot's `detect_assault` use VideoMAE (`OPear/videomae-large-finetuned-UCF-Crime`,
~1.2 GB). Weights are not in git or the snapshot; fetch them into `backend/data/models/assault_videomae`:

```powershell
cd backend
python -m app.detection.assault_detector
```

Then on the Assault page choose a camera and a video and press **Run assault scan** (about 40 s per 5 minutes of
video on the RTX 4060). Windows of 2 s are classified into the 14 UCF-Crime classes; Assault, Fighting, Abuse,
Robbery or Shooting at 60 % or more raises one alert per video for officer review. It is decision support: on
public test clips it caught a staged fight at 97 % but missed a street fight at 50 %.

## 6. Antivirus HTTPS scanning (Avast and similar)

The backend's S3 access works with HTTPS scanning on. Other tools may not: Git Bash `git fetch` needs
`git -c http.sslBackend=schannel ...`, and cloud LLM / Hugging Face downloads can fail. Turning HTTPS
scanning off (then restarting) fixes all of them.
