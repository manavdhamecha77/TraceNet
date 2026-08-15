# PDF Crime Report Generation System

Complete guide for generating professional PDF crime incident reports in the TraceNet DRISHTI system.

## Overview

The Report Generation System provides automated creation of professional crime incident reports in PDF format. It supports multiple crime types (theft, assault, abandoned objects, loitering) with customizable severity levels and investigation tracking.

---

## Crime Report Types

### 1. Theft / Shoplifting
```json
{
  "report_type": "theft",
  "title": "Retail Store Theft Incident",
  "description": "Suspected shoplifting at electronics department",
  "location": "Store Location",
  "severity": "high"
}
```
**Use For:** Store theft, shoplifting, inventory loss incidents

### 2. Assault / Violence
```json
{
  "report_type": "assault",
  "title": "Physical Assault Incident",
  "description": "Two individuals engaged in physical altercation",
  "location": "Intersection/Area",
  "severity": "critical"
}
```
**Use For:** Physical violence, fights, weapon involvement

### 3. Abandoned Objects
```json
{
  "report_type": "abandoned_object",
  "title": "Suspicious Unattended Package",
  "description": "Unattended backpack in parking area",
  "location": "Parking Lot",
  "severity": "high"
}
```
**Use For:** Suspicious packages, unattended items, potential security threats

### 4. Loitering
```json
{
  "report_type": "loitering",
  "title": "Prolonged Loitering Activity",
  "description": "Individual loitering in restricted area",
  "location": "Restricted Zone",
  "severity": "low"
}
```
**Use For:** Suspicious loitering, trespassing, unauthorized presence

---

## Severity Levels

| Level | Color | Usage | Examples |
|-------|-------|-------|----------|
| **Low** | Green | Minor incidents | Loitering, minor violations |
| **Medium** | Yellow | Moderate concerns | Suspicious activity, minor theft |
| **High** | Red | Serious incidents | Significant theft, violence warning |
| **Critical** | Dark Red | Emergency situations | Severe assault, weapons, immediate danger |

---

## API Endpoints

### 1. Generate New Report

**Endpoint:**
```http
POST /api/v1/reports/generate
```

**Request Body:**
```json
{
  "report_type": "theft",
  "alert_id": 42,
  "camera_id": "CAM_001",
  "title": "Retail Store Theft Incident",
  "description": "Suspected shoplifting detected at 14:35. Subject matched known shoplifter profile.",
  "location": "Electronics Department, Store #42",
  "severity": "high",
  "notes": "Subject left store without paying for two items. CCTV footage available.",
  "assigned_to": "Officer Johnson",
  "created_by": "system_user"
}
```

**Response:**
```json
{
  "id": "report_abc123def456",
  "report_type": "theft",
  "alert_id": 42,
  "camera_id": "CAM_001",
  "title": "Retail Store Theft Incident",
  "severity": "high",
  "status": "pending",
  "detection_confidence": 0.95,
  "frame_count": 45,
  "incident_timestamp": "2024-08-12T14:35:00Z",
  "report_generated_at": "2024-08-12T14:40:00Z",
  "pdf_file_path": null,
  "pdf_generated_at": null,
  "assigned_to": "Officer Johnson",
  "location": "Electronics Department, Store #42"
}
```

**Status Codes:**
- `200` - Report created successfully
- `404` - Camera not found
- `500` - Server error

---

### 2. Generate PDF File

**Endpoint:**
```http
POST /api/v1/reports/{report_id}/generate-pdf
```

**Parameters:**
- `report_id` (path): Report ID from creation response

**Response:**
```json
{
  "status": "success",
  "report_id": "report_abc123def456",
  "pdf_path": "/data/reports/report_abc123def456.pdf",
  "generated_at": "2024-08-12T14:42:00Z"
}
```

**Notes:**
- Converts report to professional PDF format
- Updates report status to "reviewed"
- Generates comprehensive incident documentation

---

### 3. Download PDF

**Endpoint:**
```http
GET /api/v1/reports/{report_id}/pdf
```

**Response:** Binary PDF file

**Usage:**
```bash
curl -X GET http://localhost:8000/api/v1/reports/report_abc123def456/pdf \
  -H "Authorization: Bearer token" \
  -o crime_report.pdf
```

---

### 4. List Reports

**Endpoint:**
```http
GET /api/v1/reports
```

**Query Parameters:**
- `report_type` (optional): Filter by type (theft, assault, abandoned_object, loitering)
- `camera_id` (optional): Filter by camera
- `severity` (optional): Filter by severity (low, medium, high, critical)
- `status` (optional): Filter by status (pending, reviewed, archived)
- `limit` (optional): Max results (default: 50)
- `offset` (optional): Pagination offset (default: 0)

**Example:**
```bash
# Get all high-severity theft reports
curl -X GET "http://localhost:8000/api/v1/reports?report_type=theft&severity=high" \
  -H "Authorization: Bearer token"

# Get assault reports from specific camera
curl -X GET "http://localhost:8000/api/v1/reports?report_type=assault&camera_id=CAM_001" \
  -H "Authorization: Bearer token"

# Pagination
curl -X GET "http://localhost:8000/api/v1/reports?limit=10&offset=20" \
  -H "Authorization: Bearer token"
```

**Response:**
```json
{
  "reports": [
    {
      "id": "report_abc123def456",
      "report_type": "theft",
      "alert_id": 42,
      "camera_id": "CAM_001",
      "title": "Retail Store Theft Incident",
      "severity": "high",
      "status": "reviewed",
      "detection_confidence": 0.95,
      "frame_count": 45,
      "incident_timestamp": "2024-08-12T14:35:00Z",
      "report_generated_at": "2024-08-12T14:40:00Z",
      "pdf_generated_at": "2024-08-12T14:42:00Z"
    }
  ],
  "total": 127
}
```

---

### 5. Get Specific Report

**Endpoint:**
```http
GET /api/v1/reports/{report_id}
```

**Response:** Complete report details (JSON)

---

### 6. Update Report

**Endpoint:**
```http
PUT /api/v1/reports/{report_id}
```

**Request Body:**
```json
{
  "status": "reviewed",
  "assigned_to": "Officer Smith",
  "notes": "Investigation ongoing. Suspect identified from facial recognition.",
  "severity": "critical",
  "description": "Updated incident description"
}
```

**Updatable Fields:**
- `status` - Report status (pending, reviewed, archived)
- `assigned_to` - Officer name
- `notes` - Investigation notes
- `severity` - Incident severity
- `description` - Detailed description

**Response:** Updated report JSON

---

### 7. Delete Report

**Endpoint:**
```http
DELETE /api/v1/reports/{report_id}
```

**Response:**
```json
{
  "status": "success",
  "message": "Report report_abc123def456 deleted"
}
```

**Notes:**
- Deletes report record from database
- Removes associated PDF file
- Permanent operation

---

### 8. Crime Statistics

**Endpoint:**
```http
GET /api/v1/reports/statistics/summary?days=30
```

**Query Parameters:**
- `days` (optional): Time window in days (default: 30)

**Response:**
```json
{
  "period_days": 30,
  "total_reports": 156,
  "by_type": {
    "theft": 84,
    "assault": 32,
    "abandoned_object": 28,
    "loitering": 12
  },
  "by_severity": {
    "low": 45,
    "medium": 56,
    "high": 38,
    "critical": 17
  }
}
```

---

## PDF Report Format

### Report Sections

1. **Header**
   - Report title: "CRIME INCIDENT REPORT"
   - Report type, severity level, generation date
   - Color-coded severity indicator

2. **Incident Details**
   - Title of incident
   - Camera ID and location
   - Incident timestamp
   - Detection timestamp

3. **Detection Analysis**
   - Confidence score (if available)
   - Frames analyzed
   - Detected objects
   - Detection quality metrics

4. **Incident Description**
   - Full narrative description
   - Context and circumstances

5. **Investigator Notes**
   - Officer observations
   - Additional details
   - Follow-up information

6. **Investigation**
   - Assigned officer
   - Report creator
   - Report generation date

7. **Footer**
   - Confidentiality notice
   - Generation timestamp

### Visual Design

- **Professional Layout:** Letter-size page (8.5" x 11")
- **Color Coding:** Severity levels color-coded for quick identification
- **Tables:** Structured data in professional tables
- **Typography:** Clear hierarchy with section headers
- **Spacing:** Optimal white space for readability

---

## Usage Examples

### Python

```python
import requests
import json

BASE_URL = "http://localhost:8000/api/v1"
TOKEN = "your_auth_token"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}

# 1. Create a report
report_data = {
    "report_type": "theft",
    "camera_id": "CAM_001",
    "title": "Retail Theft - Electronics",
    "description": "Suspect concealed merchandise and exited without paying",
    "location": "Electronics Department",
    "severity": "high",
    "notes": "Suspect matching known shoplifter profile",
    "assigned_to": "Officer Johnson"
}

response = requests.post(
    f"{BASE_URL}/reports/generate",
    json=report_data,
    headers=HEADERS
)
report = response.json()
report_id = report["id"]

print(f"Report created: {report_id}")

# 2. Generate PDF
response = requests.post(
    f"{BASE_URL}/reports/{report_id}/generate-pdf",
    headers=HEADERS
)
pdf_info = response.json()
print(f"PDF generated: {pdf_info['pdf_path']}")

# 3. Download PDF
response = requests.get(
    f"{BASE_URL}/reports/{report_id}/pdf",
    headers=HEADERS
)
with open("crime_report.pdf", "wb") as f:
    f.write(response.content)

# 4. List reports with filtering
response = requests.get(
    f"{BASE_URL}/reports?report_type=theft&severity=high",
    headers=HEADERS
)
reports = response.json()
print(f"High-severity theft reports: {len(reports['reports'])}")

# 5. Update report status
update_data = {
    "status": "reviewed",
    "notes": "Investigation complete. Case forwarded to prosecution."
}
requests.put(
    f"{BASE_URL}/reports/{report_id}",
    json=update_data,
    headers=HEADERS
)

# 6. Get statistics
response = requests.get(
    f"{BASE_URL}/reports/statistics/summary?days=30",
    headers=HEADERS
)
stats = response.json()
print(f"Total reports (30 days): {stats['total_reports']}")
print(f"By type: {stats['by_type']}")
```

### JavaScript/TypeScript

```typescript
const BASE_URL = "http://localhost:8000/api/v1";
const TOKEN = "your_auth_token";

// 1. Create report
async function createReport(reportData: any) {
  const response = await fetch(`${BASE_URL}/reports/generate`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(reportData)
  });
  return response.json();
}

// 2. Generate PDF
async function generatePDF(reportId: string) {
  const response = await fetch(
    `${BASE_URL}/reports/${reportId}/generate-pdf`,
    {
      method: "POST",
      headers: { "Authorization": `Bearer ${TOKEN}` }
    }
  );
  return response.json();
}

// 3. Download PDF
async function downloadPDF(reportId: string) {
  const response = await fetch(
    `${BASE_URL}/reports/${reportId}/pdf`,
    {
      headers: { "Authorization": `Bearer ${TOKEN}` }
    }
  );
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${reportId}.pdf`;
  a.click();
}

// 4. List reports
async function listReports(filters: any = {}) {
  const params = new URLSearchParams(filters);
  const response = await fetch(
    `${BASE_URL}/reports?${params}`,
    {
      headers: { "Authorization": `Bearer ${TOKEN}` }
    }
  );
  return response.json();
}

// 5. Get statistics
async function getStatistics(days: number = 30) {
  const response = await fetch(
    `${BASE_URL}/reports/statistics/summary?days=${days}`,
    {
      headers: { "Authorization": `Bearer ${TOKEN}` }
    }
  );
  return response.json();
}
```

### cURL

```bash
# 1. Create report
curl -X POST http://localhost:8000/api/v1/reports/generate \
  -H "Authorization: Bearer token" \
  -H "Content-Type: application/json" \
  -d '{
    "report_type": "theft",
    "camera_id": "CAM_001",
    "title": "Retail Theft",
    "description": "Shoplifting incident",
    "severity": "high"
  }' > report.json

REPORT_ID=$(jq -r '.id' report.json)

# 2. Generate PDF
curl -X POST http://localhost:8000/api/v1/reports/$REPORT_ID/generate-pdf \
  -H "Authorization: Bearer token"

# 3. Download PDF
curl -X GET http://localhost:8000/api/v1/reports/$REPORT_ID/pdf \
  -H "Authorization: Bearer token" \
  -o crime_report.pdf

# 4. List reports
curl -X GET "http://localhost:8000/api/v1/reports?severity=high" \
  -H "Authorization: Bearer token"

# 5. Get statistics
curl -X GET "http://localhost:8000/api/v1/reports/statistics/summary?days=30" \
  -H "Authorization: Bearer token"
```

---

## Database Schema

### crime_reports Table

| Column | Type | Description |
|--------|------|-------------|
| id | VARCHAR (PK) | Unique report identifier |
| report_type | VARCHAR | Type of crime (theft, assault, etc.) |
| alert_id | INTEGER (FK) | Associated alert |
| camera_id | VARCHAR (FK) | Camera that detected incident |
| video_id | VARCHAR (FK) | Associated video file |
| title | VARCHAR | Report title |
| description | TEXT | Detailed description |
| severity | VARCHAR | Incident severity |
| status | VARCHAR | Report status |
| detection_confidence | FLOAT | Detection ML confidence |
| detected_objects | TEXT (JSON) | List of detected objects |
| frame_count | INTEGER | Frames analyzed |
| incident_timestamp | DATETIME | When incident occurred |
| detection_timestamp | DATETIME | When detection occurred |
| report_generated_at | DATETIME | Report creation time |
| pdf_file_path | VARCHAR | Path to PDF file |
| pdf_generated_at | DATETIME | PDF generation time |
| location | VARCHAR | Incident location |
| assigned_to | VARCHAR | Assigned officer |
| notes | TEXT | Investigation notes |
| report_data | TEXT (JSON) | Additional metadata |
| created_by | VARCHAR | Report creator |

### Indexes

```sql
CREATE INDEX idx_crime_reports_camera_id ON crime_reports(camera_id);
CREATE INDEX idx_crime_reports_report_type ON crime_reports(report_type);
CREATE INDEX idx_crime_reports_severity ON crime_reports(severity);
CREATE INDEX idx_crime_reports_status ON crime_reports(status);
```

---

## File Storage

Reports are stored in the `/data/reports/` directory with naming convention:
```
/data/reports/{report_id}.pdf
```

Example:
```
/data/reports/report_abc123def456.pdf
```

---

## Best Practices

1. **Immediate Reporting:** Generate reports immediately upon incident detection
2. **Detailed Description:** Include comprehensive incident details and context
3. **Officer Assignment:** Assign to appropriate personnel for follow-up
4. **Severity Accuracy:** Use accurate severity levels for proper prioritization
5. **Investigation Notes:** Update notes with investigation progress
6. **PDF Backup:** Keep PDF copies for records and legal proceedings
7. **Archiving:** Archive resolved cases for historical tracking

---

## Error Handling

### Common Error Responses

**Missing Camera (404):**
```json
{
  "detail": "Camera CAM_XXX not found"
}
```

**Report Not Found (404):**
```json
{
  "detail": "Report report_xxx not found"
}
```

**Server Error (500):**
```json
{
  "detail": "Failed to generate report: error details"
}
```

---

## Performance Considerations

- PDF generation typically takes 1-2 seconds
- List operations with pagination are optimized via indexes
- Statistics aggregation runs on-demand (may take longer for large datasets)
- Store PDFs on fast disk or distributed storage for production
- Consider background job queue for high-volume report generation

---

## Security & Compliance

- All report access requires authentication
- Reports contain sensitive information - handle securely
- PDF files stored with restricted access
- Audit trail maintained for all report operations
- Suitable for legal proceedings and evidence documentation

---

## Future Enhancements

- Custom report templates
- Multi-language support
- Integration with law enforcement systems
- Email distribution automation
- Batch report generation
- Report archival and compression
- Advanced analytics on report data
- Integration with case management systems

---

For more information about the reporting system, refer to the API documentation at `/api/docs`.
