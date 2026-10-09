from loguru import logger
from app.embeddings.clip_encoder import get_clip_encoder
from app.runtime.device import get_device, use_half_precision

ACTIVE_EMBEDDING_BACKEND = "clip"  # "clip" | "facenet"

class FaceEmbeddingService:
    def __init__(self):
        self._facenet_model = None

    def _get_facenet(self):
        if self._facenet_model is None:
            try:
                from facenet_pytorch import InceptionResnetV1
                import torch
                
                device = get_device()
                self._facenet_model = InceptionResnetV1(pretrained='vggface2').eval().to(device)
            except ImportError as e:
                logger.error("facenet_pytorch not installed. Run: pip install facenet-pytorch")
                raise ImportError("facenet_pytorch is required for facenet backend.") from e
        return self._facenet_model

    def embed_face_crop(self, image_path: str) -> list[float]:
        global ACTIVE_EMBEDDING_BACKEND
        if ACTIVE_EMBEDDING_BACKEND == "facenet":
            from PIL import Image
            import torch
            from torchvision import transforms
            
            device = get_device()
            model = self._get_facenet()
            transform = transforms.Compose([
                transforms.Resize((160, 160)),
                transforms.ToTensor(),
                transforms.Normalize([0.5, 0.5, 0.5], [0.5, 0.5, 0.5])
            ])
            with Image.open(image_path) as img:
                img_tensor = transform(img.convert("RGB")).unsqueeze(0).to(device)
            with torch.no_grad():
                embedding = model(img_tensor).squeeze(0).cpu().tolist()
            return embedding
        else:
            return get_clip_encoder().embed_image(image_path)

    def embed_text_query(self, text: str) -> list[float]:
        global ACTIVE_EMBEDDING_BACKEND
        if ACTIVE_EMBEDDING_BACKEND == "facenet":
            logger.warning("FaceNet does not support text embeddings. Returning zeros.")
            return [0.0] * 512
        else:
            return get_clip_encoder().embed_text(text)


def get_active_backend() -> str:
    global ACTIVE_EMBEDDING_BACKEND
    return ACTIVE_EMBEDDING_BACKEND

def set_active_backend(backend: str) -> None:
    global ACTIVE_EMBEDDING_BACKEND
    if backend in ("clip", "facenet"):
        ACTIVE_EMBEDDING_BACKEND = backend
    else:
        raise ValueError("Backend must be 'clip' or 'facenet'.")

_FACE_EMBEDDER = None

def get_face_embedder() -> FaceEmbeddingService:
    global _FACE_EMBEDDER
    if _FACE_EMBEDDER is None:
        _FACE_EMBEDDER = FaceEmbeddingService()
    return _FACE_EMBEDDER
