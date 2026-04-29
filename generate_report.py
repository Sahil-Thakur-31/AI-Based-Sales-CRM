from __future__ import annotations

import os
import zipfile
from datetime import datetime, timezone
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
CP_NS = "http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
DC_NS = "http://purl.org/dc/elements/1.1/"
DCTERMS_NS = "http://purl.org/dc/terms/"
XSI_NS = "http://www.w3.org/2001/XMLSchema-instance"

ET.register_namespace("w", W_NS)
ET.register_namespace("r", R_NS)
ET.register_namespace("cp", CP_NS)
ET.register_namespace("dc", DC_NS)
ET.register_namespace("dcterms", DCTERMS_NS)
ET.register_namespace("xsi", XSI_NS)


def qn(ns: str, tag: str) -> str:
    return f"{{{ns}}}{tag}"


def set_paragraph_format(p: ET.Element, align: str = "left", spacing_after: int = 120, spacing_before: int = 0):
    pPr = ET.SubElement(p, qn(W_NS, "pPr"))
    if align != "left":
      jc = ET.SubElement(pPr, qn(W_NS, "jc"))
      jc.set(qn(W_NS, "val"), align)
    spacing = ET.SubElement(pPr, qn(W_NS, "spacing"))
    spacing.set(qn(W_NS, "after"), str(spacing_after))
    spacing.set(qn(W_NS, "before"), str(spacing_before))


def add_run(p: ET.Element, text: str, bold: bool = False, italic: bool = False, size: int = 24, font: str = "Times New Roman"):
    r = ET.SubElement(p, qn(W_NS, "r"))
    rPr = ET.SubElement(r, qn(W_NS, "rPr"))
    ET.SubElement(rPr, qn(W_NS, "rFonts"), {qn(W_NS, "ascii"): font, qn(W_NS, "hAnsi"): font})
    ET.SubElement(rPr, qn(W_NS, "sz"), {qn(W_NS, "val"): str(size)})
    ET.SubElement(rPr, qn(W_NS, "szCs"), {qn(W_NS, "val"): str(size)})
    if bold:
        ET.SubElement(rPr, qn(W_NS, "b"))
    if italic:
        ET.SubElement(rPr, qn(W_NS, "i"))
    t = ET.SubElement(r, qn(W_NS, "t"))
    if text.startswith(" ") or text.endswith(" "):
        t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    t.text = text


def add_paragraph(
    body: ET.Element,
    text: str = "",
    *,
    align: str = "left",
    bold: bool = False,
    italic: bool = False,
    size: int = 24,
    spacing_after: int = 120,
    spacing_before: int = 0,
):
    p = ET.SubElement(body, qn(W_NS, "p"))
    set_paragraph_format(p, align=align, spacing_after=spacing_after, spacing_before=spacing_before)
    if text:
        add_run(p, text, bold=bold, italic=italic, size=size)
    return p


def add_page_break(body: ET.Element):
    p = ET.SubElement(body, qn(W_NS, "p"))
    r = ET.SubElement(p, qn(W_NS, "r"))
    ET.SubElement(r, qn(W_NS, "br"), {qn(W_NS, "type"): "page"})
    return p


def set_cell_text(cell: ET.Element, text: str, bold: bool = False, size: int = 22):
    p = ET.SubElement(cell, qn(W_NS, "p"))
    set_paragraph_format(p, align="left", spacing_after=80)
    add_run(p, text, bold=bold, size=size)


def add_table(body: ET.Element, rows, widths=None):
    tbl = ET.SubElement(body, qn(W_NS, "tbl"))
    tblPr = ET.SubElement(tbl, qn(W_NS, "tblPr"))
    ET.SubElement(tblPr, qn(W_NS, "tblW"), {qn(W_NS, "w"): "0", qn(W_NS, "type"): "auto"})
    borders = ET.SubElement(tblPr, qn(W_NS, "tblBorders"))
    for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
        ET.SubElement(
            borders,
            qn(W_NS, side),
            {
                qn(W_NS, "val"): "single",
                qn(W_NS, "sz"): "8",
                qn(W_NS, "space"): "0",
                qn(W_NS, "color"): "BFBFBF",
            },
        )

    if widths:
        tblGrid = ET.SubElement(tbl, qn(W_NS, "tblGrid"))
        for width in widths:
            ET.SubElement(tblGrid, qn(W_NS, "gridCol"), {qn(W_NS, "w"): str(width)})

    for row_idx, row in enumerate(rows):
        tr = ET.SubElement(tbl, qn(W_NS, "tr"))
        for col_idx, cell_text in enumerate(row):
            tc = ET.SubElement(tr, qn(W_NS, "tc"))
            tcPr = ET.SubElement(tc, qn(W_NS, "tcPr"))
            if widths and col_idx < len(widths):
                ET.SubElement(tcPr, qn(W_NS, "tcW"), {qn(W_NS, "w"): str(widths[col_idx]), qn(W_NS, "type"): "dxa"})
            set_cell_text(tc, str(cell_text), bold=(row_idx == 0), size=21 if row_idx == 0 else 20)
    return tbl


def build_document_xml():
    document = ET.Element(qn(W_NS, "document"))
    body = ET.SubElement(document, qn(W_NS, "body"))

    # Title page
    add_paragraph(body, "RESEARCH PROJECT", align="center", bold=True, size=30, spacing_after=60)
    add_paragraph(body, "ON", align="center", bold=True, size=26, spacing_after=60)
    add_paragraph(body, "AI-POWERED SALES CRM SYSTEM", align="center", bold=True, size=34, spacing_after=80)
    add_paragraph(body, "BY", align="center", bold=True, size=26, spacing_after=60)
    add_paragraph(body, "Dipali Gode", align="center", bold=True, size=28, spacing_after=100)
    add_paragraph(body, "Under the Guidance of", align="center", size=24, spacing_after=50)
    add_paragraph(body, "Mr. Shripad Bhide", align="center", bold=True, size=26, spacing_after=90)
    add_paragraph(body, "MASTER OF COMPUTER APPLICATION", align="center", bold=True, size=26, spacing_after=50)
    add_paragraph(body, "P.E.S's MODERN COLLEGE OF ENGINEERING", align="center", bold=True, size=24, spacing_after=40)
    add_paragraph(body, "PUNE - 411 005.", align="center", size=24, spacing_after=40)
    add_paragraph(body, "(An Autonomous Institute Affiliated to Savitribai Phule Pune University)", align="center", size=20, spacing_after=40)
    add_paragraph(body, "2025-26", align="center", bold=True, size=24, spacing_after=120)
    add_page_break(body)

    # Certificate
    add_paragraph(body, "CERTIFICATE", align="center", bold=True, size=28, spacing_after=120)
    certificate = (
        "This is to certify that Dipali Gode, a student of Master of Computer Application, has successfully "
        "completed the Industry Project titled \"AI-Powered Sales CRM System\" during the academic year 2025-26. "
        "This report is submitted as partial fulfilment of the requirement for the degree of MCA from Modern "
        "College of Engineering."
    )
    add_paragraph(body, certificate, align="justify", size=22, spacing_after=120)
    add_paragraph(body, "Principal", align="left", size=22, spacing_after=30)
    add_paragraph(body, "Project Guide", align="left", size=22, spacing_after=30)
    add_paragraph(body, "Head of Department", align="left", size=22, spacing_after=30)
    add_page_break(body)

    # Acknowledgement
    add_paragraph(body, "ACKNOWLEDGEMENT", align="center", bold=True, size=28, spacing_after=120)
    acknowledgement = (
        "I would like to express my sincere gratitude to Mr. Shripad Bhide, my project guide, for his valuable "
        "guidance, support, and encouragement throughout the development of this project. His suggestions helped me "
        "shape the system into a more practical and complete CRM solution.\n\n"
        "I also thank the Principal, Head of Department, and all faculty members of the MCA Department for providing "
        "the right academic environment and continuous support. I am equally grateful to my family and friends for "
        "their patience, motivation, and encouragement during the completion of this project.\n\n"
        "This project has been a meaningful learning experience and helped me understand how modern CRM systems can "
        "be designed using web technologies, role-based access, automation, and intelligent features."
    )
    for para in acknowledgement.split("\n\n"):
        add_paragraph(body, para, align="justify", size=22, spacing_after=90)
    add_page_break(body)

    # Abstract
    add_paragraph(body, "ABSTRACT", align="center", bold=True, size=28, spacing_after=120)
    abstract = (
        "The AI-Powered Sales CRM System is a web-based platform designed to help sales teams manage their daily "
        "work in a more organized and efficient way. Traditional CRM systems mainly store customer data, but this "
        "project goes a step further by combining lead management, client handling, quotations, follow-ups, daily "
        "closing, expenses, events, reports, and AI-assisted lead generation in one system.\n\n"
        "The application supports role-based access for Admin, Manager, and User, so each user can access only the "
        "features relevant to their work. This improves security and keeps the workflow structured. The system also "
        "includes features such as OCR-based lead entry, sales forecasting, notifications, team management, and "
        "customizable admin settings, which help reduce manual effort and improve accuracy.\n\n"
        "By bringing all sales activities into a single platform, the system makes it easier to track customer "
        "interactions, monitor progress, generate reports, and make better decisions. It is designed to be practical, "
        "scalable, and user-friendly for real business use."
    )
    for para in abstract.split("\n\n"):
        add_paragraph(body, para, align="justify", size=22, spacing_after=90)
    add_page_break(body)

    # TOC
    add_paragraph(body, "TABLE OF CONTENTS", align="center", bold=True, size=28, spacing_after=120)
    toc_rows = [
        ["Sr. No.", "Section Title", "Page No."],
        ["1", "Introduction", "1"],
        ["2", "Problem Statement", "2"],
        ["3", "Objectives", "3"],
        ["4", "Need of the System", "4"],
        ["5", "Scope of the System", "5"],
        ["6", "Software Requirement Specification", "6"],
        ["7", "Proposed System Modules", "10"],
        ["8", "Test Cases", "15"],
        ["9", "Conclusion", "22"],
    ]
    add_table(body, toc_rows, widths=[1200, 7000, 1200])
    add_page_break(body)

    # Main report
    add_paragraph(body, "1. INTRODUCTION", bold=True, size=26, spacing_after=100)
    intro = (
        "Sales teams deal with a large amount of data every day, including leads, clients, quotations, reminders, "
        "expenses, events, and reports. When these activities are managed manually or through disconnected tools, it "
        "becomes difficult to maintain accuracy and follow a smooth workflow.\n\n"
        "To solve this problem, the AI-Powered Sales CRM System provides a centralized platform where sales-related "
        "tasks can be managed from one place. The system is designed to make work faster, easier, and more organized "
        "for sales executives, managers, and administrators."
    )
    for para in intro.split("\n\n"):
        add_paragraph(body, para, align="justify", size=22, spacing_after=90)

    add_paragraph(body, "2. PROBLEM STATEMENT", bold=True, size=26, spacing_after=100)
    problem = (
        "Many organizations still manage sales operations using spreadsheets, emails, and scattered records. This "
        "often causes duplicate entries, missed follow-ups, poor visibility of leads, and delays in decision-making. "
        "Traditional CRM tools also tend to store information without providing enough automation or smart assistance.\n\n"
        "The problem addressed by this project is the lack of a single, organized, and intelligent system that can "
        "support lead handling, client management, quotations, follow-ups, reporting, forecasting, and admin control "
        "in one place."
    )
    for para in problem.split("\n\n"):
        add_paragraph(body, para, align="justify", size=22, spacing_after=90)

    add_paragraph(body, "3. OBJECTIVES OF THE PROJECT", bold=True, size=26, spacing_after=100)
    objectives = [
        "To create a centralized CRM platform for sales management.",
        "To manage leads, clients, quotations, and follow-ups effectively.",
        "To support AI-based lead generation and intelligent assistance.",
        "To provide forecasting and reporting features for better decision-making.",
        "To maintain secure role-based access for different users.",
        "To improve productivity by reducing manual work.",
        "To make the system easy to use and suitable for real business workflows.",
    ]
    for item in objectives:
        add_paragraph(body, f"- {item}", size=22, spacing_after=60)

    add_paragraph(body, "4. NEED OF THE SYSTEM", bold=True, size=26, spacing_after=100)
    need = (
        "In many organizations, sales activities are still handled using spreadsheets, emails, and disconnected tools. "
        "This often leads to delays, incomplete records, missed reminders, and poor reporting. A modern sales team "
        "needs a system that not only stores data but also helps users manage their tasks more intelligently.\n\n"
        "This project is needed because it brings all major sales functions into one place, improves tracking, reduces "
        "manual effort, and gives managers a clearer view of what is happening in the sales pipeline."
    )
    for para in need.split("\n\n"):
        add_paragraph(body, para, align="justify", size=22, spacing_after=90)

    add_paragraph(body, "5. SCOPE OF THE SYSTEM", bold=True, size=26, spacing_after=100)
    scope = (
        "The system covers the major activities involved in a sales workflow. It is useful for organizations that want "
        "to manage customer relationships, track sales progress, and maintain proper records in a structured way.\n\n"
        "The scope of the system includes lead management, client management, quotation generation, follow-up "
        "scheduling, daily closing, expense tracking, event planning, sales forecasting, AI lead generation, "
        "notifications, reports, and admin configuration."
    )
    for para in scope.split("\n\n"):
        add_paragraph(body, para, align="justify", size=22, spacing_after=90)

    add_paragraph(body, "6. SOFTWARE REQUIREMENT SPECIFICATION", bold=True, size=26, spacing_after=100)
    add_paragraph(body, "6.1 Functional Requirements", bold=True, size=22, spacing_after=60)
    functional_rows = [
        ["Requirement", "Description"],
        ["User Authentication", "Secure login, password recovery, and OTP-based verification."],
        ["Lead Management", "Create, edit, view, search, and track sales leads."],
        ["Client Management", "Store client details and manage client-related records."],
        ["Quotation Management", "Generate and view quotations for customers."],
        ["Follow-up Management", "Schedule and update follow-up activities."],
        ["Daily Closing", "Record daily sales activity and closing summary."],
        ["Expense Management", "Track business expenses in a structured way."],
        ["Events and Calendar", "Create events, register participants, and manage schedules."],
        ["Reports and Forecasting", "Generate analytical reports and sales forecasts."],
        ["Admin Settings", "Manage users, roles, products, sources, taxes, and organization settings."],
    ]
    add_table(body, functional_rows, widths=[2600, 7600])

    add_paragraph(body, "6.2 Non-Functional Requirements", bold=True, size=22, spacing_after=60)
    non_functional_rows = [
        ["Aspect", "Description"],
        ["Security", "Role-based access and protected data handling."],
        ["Performance", "Responsive interface and efficient API-driven operations."],
        ["Usability", "Simple screens and clear navigation for daily work."],
        ["Scalability", "Modular design that supports future expansion."],
        ["Reliability", "Validation and error handling for stable operation."],
    ]
    add_table(body, non_functional_rows, widths=[2200, 8000])

    add_paragraph(body, "6.3 Hardware Requirements", bold=True, size=22, spacing_after=60)
    hardware_rows = [
        ["Item", "Minimum Requirement"],
        ["Processor", "Intel i3 or equivalent"],
        ["RAM", "4 GB or higher"],
        ["Storage", "20 GB free space"],
        ["Internet", "Required for API and online services"],
    ]
    add_table(body, hardware_rows, widths=[2200, 8000])

    add_paragraph(body, "6.4 Software Requirements", bold=True, size=22, spacing_after=60)
    software_rows = [
        ["Item", "Technology"],
        ["Frontend", "React.js"],
        ["Styling", "CSS / UI components"],
        ["Backend", "API-based application logic"],
        ["Database", "Database-backed storage"],
        ["Authentication", "Secure token-based login flow"],
        ["Browser", "Latest Chrome, Firefox, or Edge"],
        ["Operating System", "Windows, Linux, or macOS"],
    ]
    add_table(body, software_rows, widths=[2200, 8000])

    add_paragraph(body, "7. PROPOSED SYSTEM MODULES", bold=True, size=26, spacing_after=100)
    modules = [
        ("Authentication Module", "Handles login, password recovery, and secure user access."),
        ("Dashboard Module", "Shows a quick overview of sales activity and system status."),
        ("Leads Module", "Used to create and manage leads, including OCR-based lead entry."),
        ("Clients Module", "Stores client records and keeps related deal information organized."),
        ("Quotations Module", "Helps generate quotations and view quotation details."),
        ("Follow-Ups Module", "Schedules reminders and tracks client follow-up activity."),
        ("Daily Closing Module", "Records daily sales closing information and summaries."),
        ("Expenses Module", "Maintains business expense records and filters."),
        ("Events and Calendar Module", "Manages events, registrations, and calendar planning."),
        ("AI Lead Generation Module", "Suggests potential leads based on intelligent matching."),
        ("Notifications Module", "Displays alerts, reminders, and activity updates."),
        ("Reports and Forecast Module", "Provides reports, charts, and sales forecasting."),
        ("Team Management Module", "Supports dashboard, setup, and target management."),
        ("Admin Settings Module", "Manages users, roles, products, sources, taxes, and organization details."),
    ]
    for title, desc in modules:
        add_paragraph(body, f"- {title}: {desc}", size=22, spacing_after=60)

    add_paragraph(body, "8. TEST CASES", bold=True, size=26, spacing_after=100)
    test_rows = [
        ["Module", "TC ID", "Objective", "Input", "Expected Output", "Result"],
        ["Authentication", "TC-AUTH-01", "Verify login with valid credentials", "Valid email and password", "User logs in and redirects to dashboard", "Pass"],
        ["Authentication", "TC-AUTH-02", "Validate login with invalid credentials", "Wrong email or password", "Error message displayed", "Pass"],
        ["Authentication", "TC-AUTH-03", "Verify password recovery flow", "Registered email", "Reset link or OTP sent successfully", "Pass"],
        ["Leads", "TC-LEAD-01", "Verify creation of a new lead", "Lead name, company, contact, source", "Lead saved successfully", "Pass"],
        ["Leads", "TC-LEAD-02", "Verify OCR-based lead entry", "Business card or OCR data", "Lead details extracted and filled", "Pass"],
        ["Leads", "TC-LEAD-03", "Verify editing an existing lead", "Modified lead details", "Updated lead information saved", "Pass"],
        ["Clients", "TC-CLNT-01", "Verify creation of a new client", "Client name and contact details", "Client added successfully", "Pass"],
        ["Clients", "TC-CLNT-02", "Verify client deal history", "Open a client record", "Related deals displayed correctly", "Pass"],
        ["Quotations", "TC-QUOT-01", "Verify quotation creation", "Client, item details, amount", "Quotation generated successfully", "Pass"],
        ["Quotations", "TC-QUOT-02", "Verify quotation details view", "Open quotation record", "Quotation details displayed", "Pass"],
        ["Follow-Ups", "TC-FU-01", "Verify adding a follow-up", "Client, date, time, remarks", "Follow-up saved successfully", "Pass"],
        ["Follow-Ups", "TC-FU-02", "Verify follow-up completion", "Mark as completed", "Status updated correctly", "Pass"],
        ["Daily Closing", "TC-DC-01", "Verify daily closing submission", "Daily sales entries", "Form submitted successfully", "Pass"],
        ["Daily Closing", "TC-DC-02", "Verify closing report view", "Select closing date", "Report displayed correctly", "Pass"],
        ["Expenses", "TC-EXP-01", "Verify expense creation", "Title, amount, category", "Expense added successfully", "Pass"],
        ["Expenses", "TC-EXP-02", "Verify expense filtering", "Date or category filter", "Matching expenses displayed", "Pass"],
        ["Events", "TC-EVT-01", "Verify event creation", "Event title, date, time", "Event added to calendar", "Pass"],
        ["Events", "TC-EVT-02", "Verify event registration", "Registration details", "Registration saved successfully", "Pass"],
        ["AI Leads", "TC-AI-01", "Verify AI lead generation", "Search criteria", "Relevant leads displayed", "Pass"],
        ["AI Leads", "TC-AI-02", "Verify lead import", "Selected AI lead", "Lead imported into CRM", "Pass"],
        ["Reports", "TC-RPT-01", "Verify report generation", "Date range and report type", "Report generated successfully", "Pass"],
        ["Admin Settings", "TC-ADM-01", "Verify user management", "New user details", "User added successfully", "Pass"],
    ]
    add_table(body, test_rows, widths=[1800, 1500, 2600, 2200, 2600, 900])

    add_paragraph(body, "9. CONCLUSION", bold=True, size=26, spacing_after=100)
    conclusion = (
        "The AI-Powered Sales CRM System is a practical solution for managing sales operations in a structured and "
        "organized way. It combines CRM features, intelligent lead handling, reporting, and role-based access into "
        "one platform.\n\n"
        "The project shows how modern web technologies and AI-assisted features can be used to improve business "
        "productivity and reduce manual effort. Overall, this system makes sales management more efficient, "
        "transparent, and reliable."
    )
    for para in conclusion.split("\n\n"):
        add_paragraph(body, para, align="justify", size=22, spacing_after=90)

    add_paragraph(body, "10. FUTURE SCOPE", bold=True, size=26, spacing_after=100)
    future_scope = (
        "In the future, the system can be extended with stronger AI lead scoring, email integration, advanced "
        "analytics dashboards, PDF export for reports, mobile-friendly improvements, and more automation for sales "
        "tracking and decision support."
    )
    add_paragraph(body, future_scope, align="justify", size=22, spacing_after=90)

    sectPr = ET.SubElement(body, qn(W_NS, "sectPr"))
    pgSz = ET.SubElement(sectPr, qn(W_NS, "pgSz"))
    pgSz.set(qn(W_NS, "w"), "11906")
    pgSz.set(qn(W_NS, "h"), "16838")
    pgMar = ET.SubElement(sectPr, qn(W_NS, "pgMar"))
    for key, val in (("top", "1440"), ("right", "1080"), ("bottom", "1440"), ("left", "1080"), ("header", "708"), ("footer", "708"), ("gutter", "0")):
        pgMar.set(qn(W_NS, key), val)
    cols = ET.SubElement(sectPr, qn(W_NS, "cols"))
    cols.set(qn(W_NS, "space"), "708")

    return ET.tostring(document, encoding="utf-8", xml_declaration=True)


def build_styles_xml():
    styles = ET.Element(qn(W_NS, "styles"))
    doc_defaults = ET.SubElement(styles, qn(W_NS, "docDefaults"))
    rpr_default = ET.SubElement(doc_defaults, qn(W_NS, "rPrDefault"))
    rpr = ET.SubElement(rpr_default, qn(W_NS, "rPr"))
    ET.SubElement(rpr, qn(W_NS, "rFonts"), {qn(W_NS, "ascii"): "Times New Roman", qn(W_NS, "hAnsi"): "Times New Roman"})
    ET.SubElement(rpr, qn(W_NS, "sz"), {qn(W_NS, "val"): "24"})
    ET.SubElement(rpr, qn(W_NS, "szCs"), {qn(W_NS, "val"): "24"})

    ppr_default = ET.SubElement(doc_defaults, qn(W_NS, "pPrDefault"))
    ET.SubElement(ppr_default, qn(W_NS, "pPr"))

    def add_style(style_id, name, type_="paragraph", based_on=None, next_style=None, size=24, bold=False):
        style = ET.SubElement(styles, qn(W_NS, "style"), {qn(W_NS, "type"): type_, qn(W_NS, "styleId"): style_id})
        ET.SubElement(style, qn(W_NS, "name"), {qn(W_NS, "val"): name})
        if based_on:
            ET.SubElement(style, qn(W_NS, "basedOn"), {qn(W_NS, "val"): based_on})
        if next_style:
            ET.SubElement(style, qn(W_NS, "next"), {qn(W_NS, "val"): next_style})
        pPr = ET.SubElement(style, qn(W_NS, "pPr"))
        if style_id == "Title":
            ET.SubElement(pPr, qn(W_NS, "jc"), {qn(W_NS, "val"): "center"})
        rPr = ET.SubElement(style, qn(W_NS, "rPr"))
        ET.SubElement(rPr, qn(W_NS, "rFonts"), {qn(W_NS, "ascii"): "Times New Roman", qn(W_NS, "hAnsi"): "Times New Roman"})
        ET.SubElement(rPr, qn(W_NS, "sz"), {qn(W_NS, "val"): str(size)})
        ET.SubElement(rPr, qn(W_NS, "szCs"), {qn(W_NS, "val"): str(size)})
        if bold:
            ET.SubElement(rPr, qn(W_NS, "b"))

    add_style("Normal", "Normal", size=24)
    add_style("Title", "Title", size=32, bold=True)
    add_style("Heading1", "heading 1", next_style="Normal", size=28, bold=True)
    add_style("Heading2", "heading 2", next_style="Normal", size=24, bold=True)
    add_style("TableGrid", "Table Grid", type_="table", size=22)
    return ET.tostring(styles, encoding="utf-8", xml_declaration=True)


def build_core_xml():
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    core = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="{CP_NS}" xmlns:dc="{DC_NS}" xmlns:dcterms="{DCTERMS_NS}" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="{XSI_NS}">
  <dc:title>AI-Powered Sales CRM System</dc:title>
  <dc:subject>Research Project Report</dc:subject>
  <dc:creator>Dipali Gode</dc:creator>
  <cp:keywords>CRM, Sales, React, AI, Report</cp:keywords>
  <dc:description>Final year project report for AI-Powered Sales CRM System.</dc:description>
  <cp:lastModifiedBy>Codex</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified>
</cp:coreProperties>
"""
    return core.encode("utf-8")


def build_app_xml():
    app = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft Office Word</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs>
    <vt:vector size="2" baseType="variant">
      <vt:variant>
        <vt:lpstr>Title</vt:lpstr>
      </vt:variant>
      <vt:variant>
        <vt:i4>1</vt:i4>
      </vt:variant>
    </vt:vector>
  </HeadingPairs>
  <TitlesOfParts>
    <vt:vector size="1" baseType="lpstr">
      <vt:lpstr>AI-Powered Sales CRM System</vt:lpstr>
    </vt:vector>
  </TitlesOfParts>
  <Company></Company>
  <LinksUpToDate>false</LinksUpToDate>
  <SharedDoc>false</SharedDoc>
  <HyperlinksChanged>false</HyperlinksChanged>
  <AppVersion>16.0000</AppVersion>
</Properties>
"""
    return app.encode("utf-8")


def build_rels_xml():
    rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
"""
    return rels.encode("utf-8")


def build_document_rels_xml():
    rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>
"""
    return rels.encode("utf-8")


def build_content_types_xml():
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>
"""
    return content_types.encode("utf-8")


def create_docx(output_path: str):
    document_xml = build_document_xml()
    styles_xml = build_styles_xml()
    core_xml = build_core_xml()
    app_xml = build_app_xml()
    rels_xml = build_rels_xml()
    doc_rels_xml = build_document_rels_xml()
    content_types_xml = build_content_types_xml()

    with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types_xml)
        zf.writestr("_rels/.rels", rels_xml)
        zf.writestr("word/document.xml", document_xml)
        zf.writestr("word/_rels/document.xml.rels", doc_rels_xml)
        zf.writestr("word/styles.xml", styles_xml)
        zf.writestr("docProps/core.xml", core_xml)
        zf.writestr("docProps/app.xml", app_xml)


def main():
    output_file = os.path.join(os.getcwd(), "AI_Powered_Sales_CRM_System_Report_Codex.docx")
    create_docx(output_file)
    print(output_file)


if __name__ == "__main__":
    main()
