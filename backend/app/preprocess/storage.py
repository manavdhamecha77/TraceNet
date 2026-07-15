import os
import shutil

class WORMStorageError(Exception):
    """Raised when a file operation violates Write-Once-Read-Many semantics."""
    pass

class MockStorageProvider:
    """Mock Object Store with Write-Once-Read-Many (WORM) semantics.
    
    Outputs raw assets straight to data/minio_mock/ but exposes clean API boundaries.
    """
    def __init__(self, base_dir: str = "./data/minio_mock"):
        self.base_dir = base_dir
        os.makedirs(self.base_dir, exist_ok=True)

    def upload_file(self, file_content: bytes, object_name: str) -> str:
        """Saves file bytes to the local WORM store. Raises error if file exists.
        
        Args:
            file_content: Raw bytes of the uploaded file.
            object_name: Unique object key (e.g., '{asset_id}_{original_filename}')
            
        Returns:
            The relative or absolute file path to the saved asset.
        """
        target_path = os.path.join(self.base_dir, object_name)
        
        # WORM Semantics Check
        if os.path.exists(target_path):
            raise WORMStorageError(
                f"WORM Violation: Object '{object_name}' already exists and cannot be overwritten."
            )
            
        with open(target_path, "wb") as f:
            f.write(file_content)
            
        return target_path

    def get_file_path(self, object_name: str) -> str:
        """Retrieves the physical path of the object if it exists.
        
        Args:
            object_name: The unique object key.
            
        Returns:
            Path string.
        """
        target_path = os.path.join(self.base_dir, object_name)
        if not os.path.exists(target_path):
            raise FileNotFoundError(f"Object '{object_name}' not found in WORM store.")
        return target_path

    def exists(self, object_name: str) -> bool:
        """Checks if the object exists in WORM store."""
        return os.path.exists(os.path.join(self.base_dir, object_name))
