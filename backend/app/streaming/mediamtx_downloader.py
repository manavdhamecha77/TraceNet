import platform
import os
import urllib.request
import tarfile
import zipfile
from app.config import get_data_path
from loguru import logger

def detect_platform():
    os_name = platform.system().lower()
    arch = platform.machine().lower()
    if os_name == "windows":
        os_name = "windows"
    elif os_name == "darwin":
        os_name = "darwin"
    else:
        os_name = "linux"
        
    if arch in ["x86_64", "amd64"]:
        arch = "amd64"
    elif arch in ["arm64", "aarch64"]:
        arch = "arm64"
    else:
        arch = "amd64" # Default
    return os_name, arch

def get_download_url(version='v1.12.2'):
    os_name, arch = detect_platform()
    ext = "zip" if os_name == "windows" else "tar.gz"
    return f"https://github.com/bluenviron/mediamtx/releases/download/{version}/mediamtx_{version}_{os_name}_{arch}.{ext}"

def download_and_extract(target_dir):
    os.makedirs(target_dir, exist_ok=True)
    url = get_download_url()
    os_name, _ = detect_platform()
    ext = "zip" if os_name == "windows" else "tar.gz"
    archive_path = os.path.join(target_dir, f"mediamtx_archive.{ext}")
    
    logger.info(f"Downloading MediaMTX from {url}...")
    urllib.request.urlretrieve(url, archive_path)
    
    logger.info(f"Extracting MediaMTX to {target_dir}...")
    if ext == "zip":
        with zipfile.ZipFile(archive_path, 'r') as zip_ref:
            zip_ref.extractall(target_dir)
    else:
        with tarfile.open(archive_path, 'r:gz') as tar_ref:
            tar_ref.extractall(target_dir)
            
    os.remove(archive_path)
    
    binary_name = "mediamtx.exe" if os_name == "windows" else "mediamtx"
    binary_path = os.path.join(target_dir, binary_name)
    if os_name != "windows":
        os.chmod(binary_path, 0o755)
        
    return binary_path

def ensure_mediamtx(target_dir=None):
    if target_dir is None:
        target_dir = get_data_path('mediamtx')
    
    os_name, _ = detect_platform()
    binary_name = "mediamtx.exe" if os_name == "windows" else "mediamtx"
    binary_path = os.path.join(target_dir, binary_name)
    
    if not os.path.exists(binary_path):
        binary_path = download_and_extract(target_dir)
        
    return binary_path
