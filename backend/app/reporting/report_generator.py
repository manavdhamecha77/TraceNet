"""Crime report generation module using ReportLab."""

from datetime import datetime
from io import BytesIO
import os
from loguru import logger

from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor, black, white
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
    Image, KeepTogether
)
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT, TA_JUSTIFY


class CrimeReportGenerator:
    """Generate PDF reports for crime detection incidents."""

    def __init__(self, report_data: dict):
        """
        Initialize report generator.

        Args:
            report_data: Dictionary containing report information
                - report_type: 'theft', 'assault', 'abandoned_object', 'loitering'
                - title: Report title
                - camera_id: Camera ID
                - location: Location description
                - incident_timestamp: When incident occurred
                - detection_confidence: Detection confidence score
                - severity: 'low', 'medium', 'high', 'critical'
                - detected_objects: List of detected objects
                - description: Detailed description
                - notes: Additional notes
                - assigned_to: Officer name (optional)
        """
        self.report_data = report_data
        self.styles = getSampleStyleSheet()
        self._setup_custom_styles()

    def _setup_custom_styles(self):
        """Setup custom paragraph styles."""
        # Title style
        self.styles.add(ParagraphStyle(
            name='CustomTitle',
            parent=self.styles['Heading1'],
            fontSize=24,
            textColor=HexColor('#1a1a1a'),
            spaceAfter=30,
            alignment=TA_CENTER,
            fontName='Helvetica-Bold'
        ))

        # Subtitle style
        self.styles.add(ParagraphStyle(
            name='Subtitle',
            parent=self.styles['Heading2'],
            fontSize=14,
            textColor=HexColor('#333333'),
            spaceAfter=12,
            fontName='Helvetica-Bold'
        ))

        # Section header style
        self.styles.add(ParagraphStyle(
            name='SectionHeader',
            parent=self.styles['Heading3'],
            fontSize=12,
            textColor=white,
            backColor=HexColor('#2c3e50'),
            spaceAfter=6,
            spaceBefore=12,
            fontName='Helvetica-Bold',
            leftIndent=10
        ))

        # Normal text
        self.styles.add(ParagraphStyle(
            name='CustomNormal',
            parent=self.styles['Normal'],
            fontSize=10,
            alignment=TA_JUSTIFY,
            spaceAfter=6
        ))

        # Label style (for field names)
        self.styles.add(ParagraphStyle(
            name='Label',
            parent=self.styles['Normal'],
            fontSize=9,
            textColor=HexColor('#555555'),
            fontName='Helvetica-Bold',
            spaceAfter=2
        ))

    def _get_severity_color(self, severity: str) -> str:
        """Get color based on severity level."""
        severity_colors = {
            'low': '#27ae60',
            'medium': '#f39c12',
            'high': '#e74c3c',
            'critical': '#c0392b'
        }
        return severity_colors.get(severity.lower(), '#95a5a6')

    def _create_header(self) -> list:
        """Create report header section."""
        story = []

        # Main title
        title = Paragraph("CRIME INCIDENT REPORT", self.styles['CustomTitle'])
        story.append(title)

        # Report metadata
        severity = self.report_data.get('severity', 'medium')
        severity_color = self._get_severity_color(severity)

        header_data = [
            ['Report Type', 'Severity', 'Date Generated'],
            [
                self.report_data.get('report_type', 'Unknown').replace('_', ' ').title(),
                f"<font color='{severity_color}'><b>{severity.upper()}</b></font>",
                datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            ]
        ]

        header_table = Table(header_data, colWidths=[2*inch, 2*inch, 2*inch])
        header_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), HexColor('#2c3e50')),
            ('TEXTCOLOR', (0, 0), (-1, 0), white),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 11),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('TOPPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, 1), HexColor('#ecf0f1')),
            ('FONTSIZE', (0, 1), (-1, 1), 10),
            ('TOPPADDING', (0, 1), (-1, 1), 10),
            ('BOTTOMPADDING', (0, 1), (-1, 1), 10),
            ('GRID', (0, 0), (-1, -1), 1, HexColor('#bdc3c7'))
        ]))

        story.append(header_table)
        story.append(Spacer(1, 0.3*inch))

        return story

    def _create_incident_section(self) -> list:
        """Create incident details section."""
        story = []

        story.append(Paragraph("INCIDENT DETAILS", self.styles['SectionHeader']))
        story.append(Spacer(1, 0.1*inch))

        # Create incident details table
        incident_data = [
            [
                Paragraph("<b>Title:</b>", self.styles['Label']),
                Paragraph(self.report_data.get('title', 'N/A'), self.styles['CustomNormal'])
            ],
            [
                Paragraph("<b>Camera ID:</b>", self.styles['Label']),
                Paragraph(self.report_data.get('camera_id', 'N/A'), self.styles['CustomNormal'])
            ],
            [
                Paragraph("<b>Location:</b>", self.styles['Label']),
                Paragraph(self.report_data.get('location', 'N/A'), self.styles['CustomNormal'])
            ],
            [
                Paragraph("<b>Incident Time:</b>", self.styles['Label']),
                Paragraph(
                    self.report_data.get('incident_timestamp', 'N/A'),
                    self.styles['CustomNormal']
                )
            ],
            [
                Paragraph("<b>Detection Time:</b>", self.styles['Label']),
                Paragraph(
                    self.report_data.get('detection_timestamp', 'N/A'),
                    self.styles['CustomNormal']
                )
            ]
        ]

        table = Table(incident_data, colWidths=[1.5*inch, 4.5*inch])
        table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('ROWBACKGROUNDS', (0, 0), (-1, -1), [white, HexColor('#f8f9fa')]),
            ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#ecf0f1')),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8)
        ]))

        story.append(table)
        story.append(Spacer(1, 0.2*inch))

        return story

    def _create_detection_section(self) -> list:
        """Create detection details section."""
        story = []

        story.append(Paragraph("DETECTION ANALYSIS", self.styles['SectionHeader']))
        story.append(Spacer(1, 0.1*inch))

        confidence = self.report_data.get('detection_confidence', 0)
        confidence_str = f"{confidence * 100:.1f}%" if isinstance(confidence, float) else "N/A"

        detection_data = [
            [
                Paragraph("<b>Confidence Score:</b>", self.styles['Label']),
                Paragraph(confidence_str, self.styles['CustomNormal'])
            ],
            [
                Paragraph("<b>Frames Analyzed:</b>", self.styles['Label']),
                Paragraph(str(self.report_data.get('frame_count', 0)), self.styles['CustomNormal'])
            ],
            [
                Paragraph("<b>Detected Objects:</b>", self.styles['Label']),
                Paragraph(
                    ', '.join(self.report_data.get('detected_objects', [])) or 'None',
                    self.styles['CustomNormal']
                )
            ]
        ]

        table = Table(detection_data, colWidths=[1.5*inch, 4.5*inch])
        table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('ROWBACKGROUNDS', (0, 0), (-1, -1), [white, HexColor('#f8f9fa')]),
            ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#ecf0f1')),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8)
        ]))

        story.append(table)
        story.append(Spacer(1, 0.2*inch))

        return story

    def _create_description_section(self) -> list:
        """Create description and notes section."""
        story = []

        story.append(Paragraph("INCIDENT DESCRIPTION", self.styles['SectionHeader']))
        story.append(Spacer(1, 0.1*inch))

        description = self.report_data.get('description', 'No description provided.')
        story.append(Paragraph(description, self.styles['CustomNormal']))

        story.append(Spacer(1, 0.2*inch))

        # Notes section
        story.append(Paragraph("INVESTIGATOR NOTES", self.styles['SectionHeader']))
        story.append(Spacer(1, 0.1*inch))

        notes = self.report_data.get('notes', 'No notes available.')
        story.append(Paragraph(notes, self.styles['CustomNormal']))

        story.append(Spacer(1, 0.2*inch))

        return story

    def _create_investigation_section(self) -> list:
        """Create investigation details section."""
        story = []

        story.append(Paragraph("INVESTIGATION", self.styles['SectionHeader']))
        story.append(Spacer(1, 0.1*inch))

        assigned_to = self.report_data.get('assigned_to', 'Unassigned')
        created_by = self.report_data.get('created_by', 'System')

        investigation_data = [
            [
                Paragraph("<b>Assigned Officer:</b>", self.styles['Label']),
                Paragraph(assigned_to, self.styles['CustomNormal'])
            ],
            [
                Paragraph("<b>Report Created By:</b>", self.styles['Label']),
                Paragraph(created_by, self.styles['CustomNormal'])
            ],
            [
                Paragraph("<b>Report Generated:</b>", self.styles['Label']),
                Paragraph(datetime.now().strftime('%Y-%m-%d %H:%M:%S'), self.styles['CustomNormal'])
            ]
        ]

        table = Table(investigation_data, colWidths=[1.5*inch, 4.5*inch])
        table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('ROWBACKGROUNDS', (0, 0), (-1, -1), [white, HexColor('#f8f9fa')]),
            ('GRID', (0, 0), (-1, -1), 0.5, HexColor('#ecf0f1')),
            ('TOPPADDING', (0, 0), (-1, -1), 8),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8)
        ]))

        story.append(table)

        return story

    def _create_footer(self) -> list:
        """Create report footer."""
        story = []

        story.append(Spacer(1, 0.3*inch))

        # Footer text
        footer_text = "This is an automatically generated crime incident report from the TraceNet DRISHTI system. " \
                     "All information contained in this report is confidential and for authorized personnel only."

        story.append(Paragraph(
            footer_text,
            ParagraphStyle(
                name='Footer',
                fontSize=8,
                textColor=HexColor('#7f8c8d'),
                alignment=TA_CENTER,
                spaceAfter=12
            )
        ))

        # Report ID
        story.append(Paragraph(
            f"Report Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
            ParagraphStyle(
                name='FooterID',
                fontSize=7,
                textColor=HexColor('#95a5a6'),
                alignment=TA_CENTER
            )
        ))

        return story

    def generate_pdf(self, output_path: str) -> bool:
        """
        Generate PDF report and save to file.

        Args:
            output_path: Path to save the PDF file

        Returns:
            True if successful, False otherwise
        """
        try:
            # Ensure directory exists
            os.makedirs(os.path.dirname(output_path), exist_ok=True)

            # Create PDF document
            doc = SimpleDocTemplate(output_path, pagesize=letter)

            # Build story
            story = []

            # Add sections
            story.extend(self._create_header())
            story.extend(self._create_incident_section())
            story.extend(self._create_detection_section())
            story.extend(self._create_description_section())
            story.append(PageBreak())
            story.extend(self._create_investigation_section())
            story.extend(self._create_footer())

            # Build PDF
            doc.build(story)

            logger.info(f"PDF report generated successfully: {output_path}")
            return True

        except Exception as e:
            logger.error(f"Failed to generate PDF report: {str(e)}")
            return False

    def generate_pdf_bytes(self) -> bytes:
        """
        Generate PDF report and return as bytes.

        Returns:
            PDF file content as bytes, or empty bytes if failed
        """
        try:
            # Create in-memory file
            buffer = BytesIO()

            # Create PDF document
            doc = SimpleDocTemplate(buffer, pagesize=letter)

            # Build story
            story = []

            # Add sections
            story.extend(self._create_header())
            story.extend(self._create_incident_section())
            story.extend(self._create_detection_section())
            story.extend(self._create_description_section())
            story.append(PageBreak())
            story.extend(self._create_investigation_section())
            story.extend(self._create_footer())

            # Build PDF
            doc.build(story)

            # Get bytes
            buffer.seek(0)
            pdf_bytes = buffer.getvalue()

            logger.info("PDF report generated successfully as bytes")
            return pdf_bytes

        except Exception as e:
            logger.error(f"Failed to generate PDF report: {str(e)}")
            return b""
