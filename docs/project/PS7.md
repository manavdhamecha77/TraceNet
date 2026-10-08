





|**Sr.**<br>**No**|**Problem Statement**<br>**ID**|**Definition**|**Domain**|
|---|---|---|---|
|**7**|**ERH26_PS_07**|AI-Driven<br>Intelligent<br>Descriptive Search System for<br>Smart City CCTV|Digital Forensics / AI<br>Video Analytics|



# **Background** 

Surat operates an extensive network of thousands of Smart City CCTV cameras. When a crime occurs, locating a getaway vehicle or a suspect currently requires human operators to watch hundreds of hours of raw footage from multiple angles to track a single target. This delay gives offenders a significant head start to leave the city limits. 

# **Problem Statement** 

There is no descriptive, natural-language search layer over the existing CCTV storage architecture. Investigators should be able to type descriptive text queries directly into a search bar — such as “Show all red hatchbacks at [Location] between 08:00 PM and 10:00 PM” or “Find a male wearing a yellow t-shirt and black cap near the railway station corridor” — and instantly retrieve matching, timestamped clips across cameras, dramatically reducing manual review time. 

# **Key Objectives** 

- Provide a natural-language descriptive search overlay for existing CCTV storage. 

- Retrieve timestamped frames/clips matching attribute or text queries across cameras. 

- Reduce manual footage-review effort and accelerate response. 

- Produce forensically sound, exportable outputs for case documentation. 

# **Functional Requirements** 

- I. Ingestion & Indexing 

   - a. Index recorded footage from multiple cameras and timeframes. 

   - b. Object, person, and vehicle detection with attribute extraction (colour, type, and clothing). 

   - c. Build a searchable metadata index over detected entities. 

- II. Descriptive Search 

   - a. Natural-language and tag-based queries (“red hatchback”, “man in yellow t- shirt and black cap”). 

   - b. Filter by camera/location, time window, and attribute. 

   - c. Search by reference image (person/vehicle re-identification). 

- III. Results & Review 

   - a. Timestamped frames/clips with camera ID and location. 

   - b. Cross-camera tracking of the same target. 

   - c. Export of matching clips, annotated images, and reports. 

- IV. Forensic Output 

   - a. Chain-of-custody metadata and integrity hashing on exports. 

   - b. Search-history and audit logging. 

# **Evaluation Criteria** 

- Accuracy and speed of descriptive retrieval. 

- Robustness across angles, lighting, and resolutions. 

- Quality of cross-camera tracking. 

- Simplicity for non-technical officers. 

- Forensic integrity of exports. 

# **Suggested Tools / Technologies** 

- Python, YOLO / Detectron2, OpenCV 

- Re-identification and attribute-recognition models, CLIP-style text-image search 

- Vector database (FAISS / Milvus), Elastic search 

- React.js dashboard 

# **Bonus Points** 

- Multi-language query support (Gujarati, Hindi). 

- License-plate and face-recognition integration where permitted. 

- Live-feed snapshot scanning for future deployments. 

- Lightweight models for edge/field deployment. 

# **Deliverables** 

- Working prototype/demo on sample CCTV footage. 

- Descriptive-search dashboard with worked queries. 

- Sample forensic export with metadata. 

- Documentation (models, indexing, integrity controls). 

