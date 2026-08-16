"""API endpoints for crime report generation and management."""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
import os
import uuid
from loguru import logger

from app.db.session import get_db
from app.db.models import CrimeReport, Alert, CameraProfile, VideoAsset
from app.config import get_data_path
from app.reporting.report_generator import CrimeReportGenerator

router = APIRouter(prefix="/api/v1", tags=["reports"])


class ReportRequest(BaseModel):
    """Request to generate a new report."""
    report_type: str  # 'theft', 'assault', 'abandoned_object', 'loitering'
    alert_id: Optional[int] = None
    camera_id: str
    title: str
    description: str
    location: Optional[str] = None
    severity: str = "medium"  # 'low', 'medium', 'high', 'critical'
    notes: Optional[str] = None
    assigned_to: Optional[str] = None
    created_by: Optional[str] = None


class ReportResponse(BaseModel):
    """Response containing report information."""
    id: str
    report_type: str
    alert_id: Optional[int]
    camera_id: str
    title: str
    severity: str
    status: str
    detection_confidence: Optional[float]
    frame_count: int
    incident_timestamp: str
    report_generated_at: str
    pdf_file_path: Optional[str]
    pdf_generated_at: Optional[str]
    assigned_to: Optional[str]
    location: Optional[str]


class ReportListResponse(BaseModel):
    """Response for listing reports."""
    reports: List[ReportResponse]
    total: int


@router.post("/reports/generate")
async def generate_report(
    request: ReportRequest,
    db: Session = Depends(get_db)
) -> ReportResponse:
    """
    Generate a new crime incident report.

    Supports: theft, assault, abandoned_object, loitering
    """
    try:
        # Validate camera exists
        camera = db.query(CameraProfile).filter(CameraProfile.camera_id == request.camera_id).first()
        if not camera:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Camera {request.camera_id} not found"
            )

        # Get alert details if provided
        alert_data = {}
        if request.alert_id:
            alert = db.query(Alert).filter(Alert.id == request.alert_id).first()
            if alert:
                alert_data = {
                    'detection_confidence': getattr(alert, 'confidence', None),
                    'video_id': alert.video_id,
                    'detected_objects': [],
                }

        # Create report record
        report_id = f"report_{uuid.uuid4().hex[:12]}"
        report = CrimeReport(
            id=report_id,
            report_type=request.report_type,
            alert_id=request.alert_id,
            camera_id=request.camera_id,
            video_id=alert_data.get('video_id'),
            title=request.title,
            description=request.description,
            location=request.location or camera.name,
            severity=request.severity,
            status="pending",
            detection_confidence=alert_data.get('detection_confidence'),
            detected_objects='[]',
            frame_count=0,
            incident_timestamp=datetime.utcnow(),
            assigned_to=request.assigned_to,
            notes=request.notes,
            created_by=request.created_by or "system"
        )

        db.add(report)
        db.commit()
        db.refresh(report)

        logger.info(f"Crime report created: {report_id}")

        return ReportResponse(**report.to_dict())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate report: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate report: {str(e)}"
        )


@router.post("/reports/{report_id}/generate-pdf")
async def generate_report_pdf(
    report_id: str,
    db: Session = Depends(get_db)
) -> dict:
    """Generate PDF file for a report."""
    try:
        # Get report
        report = db.query(CrimeReport).filter(CrimeReport.id == report_id).first()
        if not report:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Report {report_id} not found"
            )

        # Prepare report data
        report_data = {
            'report_type': report.report_type,
            'title': report.title,
            'camera_id': report.camera_id,
            'location': report.location or 'Unknown',
            'incident_timestamp': report.incident_timestamp.isoformat() if report.incident_timestamp else 'N/A',
            'detection_timestamp': report.detection_timestamp.isoformat() if report.detection_timestamp else 'N/A',
            'detection_confidence': report.detection_confidence or 0,
            'severity': report.severity,
            'detected_objects': [],
            'description': report.description or 'No description provided.',
            'notes': report.notes or 'No notes available.',
            'assigned_to': report.assigned_to or 'Unassigned',
            'created_by': report.created_by or 'System',
            'frame_count': report.frame_count
        }

        # Generate PDF
        generator = CrimeReportGenerator(report_data)

        # Create reports directory
        reports_dir = get_data_path("reports")
        os.makedirs(reports_dir, exist_ok=True)

        # Save PDF
        pdf_path = os.path.join(reports_dir, f"{report_id}.pdf")
        success = generator.generate_pdf(pdf_path)

        if not success:
            raise Exception("PDF generation failed")

        # Update report with PDF path
        report.pdf_file_path = pdf_path
        report.pdf_generated_at = datetime.utcnow()
        report.status = "reviewed"
        db.commit()

        logger.info(f"PDF generated for report {report_id}: {pdf_path}")

        return {
            "status": "success",
            "report_id": report_id,
            "pdf_path": pdf_path,
            "generated_at": report.pdf_generated_at.isoformat()
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate PDF: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate PDF: {str(e)}"
        )


@router.get("/reports/{report_id}/pdf")
async def download_report_pdf(
    report_id: str,
    db: Session = Depends(get_db)
):
    """Download PDF report file."""
    try:
        # Get report
        report = db.query(CrimeReport).filter(CrimeReport.id == report_id).first()
        if not report:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Report {report_id} not found"
            )

        if not report.pdf_file_path or not os.path.exists(report.pdf_file_path):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"PDF file not found for report {report_id}"
            )

        return FileResponse(
            report.pdf_file_path,
            media_type="application/pdf",
            filename=f"{report_id}.pdf"
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to download PDF: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to download PDF: {str(e)}"
        )


@router.get("/reports")
async def list_reports(
    report_type: Optional[str] = None,
    camera_id: Optional[str] = None,
    severity: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db)
) -> ReportListResponse:
    """List all crime reports with optional filtering."""
    try:
        query = db.query(CrimeReport)

        # Apply filters
        if report_type:
            query = query.filter(CrimeReport.report_type == report_type)
        if camera_id:
            query = query.filter(CrimeReport.camera_id == camera_id)
        if severity:
            query = query.filter(CrimeReport.severity == severity)
        if status:
            query = query.filter(CrimeReport.status == status)

        # Get total count
        total = query.count()

        # Apply pagination
        reports = query.order_by(CrimeReport.report_generated_at.desc()).offset(offset).limit(limit).all()

        report_list = [ReportResponse(**r.to_dict()) for r in reports]

        return ReportListResponse(reports=report_list, total=total)

    except Exception as e:
        logger.error(f"Failed to list reports: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list reports: {str(e)}"
        )


@router.get("/reports/{report_id}")
async def get_report(
    report_id: str,
    db: Session = Depends(get_db)
) -> ReportResponse:
    """Get a specific crime report."""
    try:
        report = db.query(CrimeReport).filter(CrimeReport.id == report_id).first()
        if not report:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Report {report_id} not found"
            )

        return ReportResponse(**report.to_dict())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get report: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get report: {str(e)}"
        )


@router.put("/reports/{report_id}")
async def update_report(
    report_id: str,
    update_data: dict,
    db: Session = Depends(get_db)
) -> ReportResponse:
    """Update a crime report."""
    try:
        report = db.query(CrimeReport).filter(CrimeReport.id == report_id).first()
        if not report:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Report {report_id} not found"
            )

        # Update allowed fields
        allowed_fields = ['status', 'assigned_to', 'notes', 'severity', 'description']
        for field, value in update_data.items():
            if field in allowed_fields:
                setattr(report, field, value)

        db.commit()
        db.refresh(report)

        logger.info(f"Report {report_id} updated")

        return ReportResponse(**report.to_dict())

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update report: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update report: {str(e)}"
        )


@router.delete("/reports/{report_id}")
async def delete_report(
    report_id: str,
    db: Session = Depends(get_db)
) -> dict:
    """Delete a crime report and its PDF file."""
    try:
        report = db.query(CrimeReport).filter(CrimeReport.id == report_id).first()
        if not report:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Report {report_id} not found"
            )

        # Delete PDF file if it exists
        if report.pdf_file_path and os.path.exists(report.pdf_file_path):
            try:
                os.remove(report.pdf_file_path)
                logger.info(f"Deleted PDF file: {report.pdf_file_path}")
            except Exception as e:
                logger.warning(f"Failed to delete PDF file: {str(e)}")

        # Delete report record
        db.delete(report)
        db.commit()

        logger.info(f"Report {report_id} deleted")

        return {"status": "success", "message": f"Report {report_id} deleted"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete report: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete report: {str(e)}"
        )


@router.get("/reports/statistics/summary")
async def get_report_statistics(
    days: int = 30,
    db: Session = Depends(get_db)
) -> dict:
    """Get crime report statistics."""
    try:
        from datetime import timedelta

        cutoff_date = datetime.utcnow() - timedelta(days=days)

        # Get counts by type
        total_reports = db.query(CrimeReport).filter(
            CrimeReport.report_generated_at >= cutoff_date
        ).count()

        by_type = {}
        for report_type in ['theft', 'assault', 'abandoned_object', 'loitering']:
            count = db.query(CrimeReport).filter(
                CrimeReport.report_type == report_type,
                CrimeReport.report_generated_at >= cutoff_date
            ).count()
            by_type[report_type] = count

        by_severity = {}
        for severity in ['low', 'medium', 'high', 'critical']:
            count = db.query(CrimeReport).filter(
                CrimeReport.severity == severity,
                CrimeReport.report_generated_at >= cutoff_date
            ).count()
            by_severity[severity] = count

        return {
            "period_days": days,
            "total_reports": total_reports,
            "by_type": by_type,
            "by_severity": by_severity
        }

    except Exception as e:
        logger.error(f"Failed to get statistics: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get statistics: {str(e)}"
        )
