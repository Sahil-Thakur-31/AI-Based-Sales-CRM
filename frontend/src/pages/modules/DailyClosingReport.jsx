import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import API from "../../api";
import "../../styles/DailyClosing.css";

function parseLocalDateInput(value) {
  if (!value) return null;
  const [year, month, day] = String(value).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function formatDateHeader(date) {
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatTime(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function getDateParam(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isOnLocalDate(rawDate, targetDateISO) {
  if (!rawDate) return false;
  const d = new Date(rawDate);
  if (Number.isNaN(d.getTime())) return false;
  return getDateParam(d) === targetDateISO;
}

function isAllowedReportStatus(item = {}) {
  const status = String(item?.status || item?.action || "").trim().toLowerCase();
  return status === "completed" || status === "cancelled" || status === "canceled";
}

function normalizeStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (status === "completed") return "completed";
  if (status === "cancelled" || status === "canceled") return "cancelled";
  return "";
}

function MinutesCell({ value, expandByDefault = false, showExpandControl = true }) {
  const fullText = String(value || "-").trim() || "-";
  const [expanded, setExpanded] = useState(expandByDefault);
  const shouldTruncate = fullText.length > 220;
  const previewText = shouldTruncate ? `${fullText.slice(0, 220).trimEnd()}...` : fullText;

  return (
    <div className="dailyClosingMinutesCell">
      <span>{expanded ? fullText : previewText}</span>
      {shouldTruncate && showExpandControl ? (
        <button
          type="button"
          className="dailyClosingReadMoreBtn"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      ) : null}
    </div>
  );
}

function ReportTableSection({
  title,
  loading,
  emptyText,
  rows,
  selectedStatus,
  onStatusChange,
  getTotalEvents,
  hideStatusToggle = false,
  expandMinutesByDefault = false,
  showExpandControl = true,
  detailsHeader = "Minutes of Meeting",
}) {
  const getClientLabel = (item = {}) =>
    String(item?.clientName || item?.client || item?.companyName || "").trim();

  const filteredRows = rows.filter((item) => normalizeStatus(item?.status) === selectedStatus);

  const countByClient = filteredRows.reduce((acc, item) => {
    const key = getClientLabel(item).toLowerCase() || "__unknown__";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return (
    <section className="dailyClosingReportSection">
      <div className="dailyClosingReportSectionHeader">
        <h3 className="dailyClosingReportSectionTitle">{title}</h3>
        {hideStatusToggle ? null : (
          <div className="dailyClosingTopToggle" role="group" aria-label={`${title} status filter`}>
            <button
              type="button"
              className={`dailyClosingTopToggleBtn ${selectedStatus === "completed" ? "isActive isCompleted" : ""}`}
              onClick={() => onStatusChange("completed")}
            >
              Completed
            </button>
            <button
              type="button"
              className={`dailyClosingTopToggleBtn ${selectedStatus === "cancelled" ? "isActive isCancelled" : ""}`}
              onClick={() => onStatusChange("cancelled")}
            >
              Cancelled
            </button>
          </div>
        )}
      </div>
      <div className="dailyClosingReportTableWrap">
        <table className="dailyClosingReportTable">
          <colgroup>
            <col className="dailyClosingColSr" />
            <col className="dailyClosingColTotal" />
            <col className="dailyClosingColClient" />
            <col className="dailyClosingColMinutes" />
          </colgroup>
          <thead>
            <tr>
              <th>Sr. No.</th>
              <th>Total Events</th>
              <th>Client Name</th>
              <th>{detailsHeader}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4}>Loading...</td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={4}>{emptyText}</td>
              </tr>
            ) : (
              filteredRows.map((item, index) => (
                <tr key={String(item._id || index)}>
                  <td>{index + 1}</td>
                  <td>
                    {getTotalEvents
                      ? getTotalEvents(item, countByClient)
                      : countByClient[getClientLabel(item).toLowerCase() || "__unknown__"] || 0}
                  </td>
                  <td>{getClientLabel(item) || "-"}</td>
                  <td>
                    <MinutesCell
                      value={item.notes || item.title || "-"}
                      expandByDefault={expandMinutesByDefault}
                      showExpandControl={showExpandControl}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function DailyClosingReport() {
  const navigate = useNavigate();
  const location = useLocation();
  const selectedDate = useMemo(() => {
    const fromState = parseLocalDateInput(location.state?.selectedDate);
    return fromState || new Date();
  }, [location.state?.selectedDate]);
  const keyHighlights = String(location.state?.keyHighlights || "").trim();

  const [meetings, setMeetings] = useState([]);
  const [followups, setFollowups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [isMailing, setIsMailing] = useState(false);
  const [employeeName, setEmployeeName] = useState("");
  const [employeeRole, setEmployeeRole] = useState("");
  const [companyName, setCompanyName] = useState("");
  const screenContentRef = useRef(null);
  const exportContentRef = useRef(null);
  const selectedDateParam = useMemo(() => getDateParam(selectedDate), [selectedDate]);
  const completedMeetings = useMemo(
    () => meetings.filter((item) => normalizeStatus(item?.status) === "completed"),
    [meetings]
  );
  const cancelledMeetings = useMemo(
    () => meetings.filter((item) => normalizeStatus(item?.status) === "cancelled"),
    [meetings]
  );
  const completedFollowups = useMemo(
    () => followups.filter((item) => normalizeStatus(item?.status) === "completed"),
    [followups]
  );
  const cancelledFollowups = useMemo(
    () => followups.filter((item) => normalizeStatus(item?.status) === "cancelled"),
    [followups]
  );

  useEffect(() => {
    (async () => {
      try {
      setLoading(true);
      setError("");
      setSuccessMessage("");
        const params = {
          today: "true",
          date: selectedDateParam,
          tzOffsetMinutes: -selectedDate.getTimezoneOffset(),
        };
        const [meetingRes, followupRes] = await Promise.all([
          API.get("/followups", { params: { ...params, kind: "meeting" } }),
          API.get("/followups", { params: { ...params, kind: "followup" } }),
        ]);
        const todayMeetings = (meetingRes.data || []).filter((row) =>
          isOnLocalDate(row?.dueDateTime, selectedDateParam)
        );
        const todayFollowups = (followupRes.data || []).filter((row) =>
          isOnLocalDate(row?.dueDateTime, selectedDateParam)
        );
        setMeetings(todayMeetings.filter(isAllowedReportStatus));
        setFollowups(todayFollowups.filter(isAllowedReportStatus));
      } catch (err) {
        console.error(err);
        setError("Failed to load report data");
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedDate, selectedDateParam]);

  useEffect(() => {
    (async () => {
      try {
        const [userRes, orgRes] = await Promise.all([
          API.get("/users/me"),
          API.get("/organizations/profile"),
        ]);
        setEmployeeName(String(userRes?.data?.name || "").trim());
        setEmployeeRole(String(userRes?.data?.role?.name || userRes?.data?.role || "").trim());
        setCompanyName(String(orgRes?.data?.organization?.name || "").trim());
      } catch (metaErr) {
        console.error("Failed to fetch report header metadata:", metaErr);
      }
    })();
  }, []);

  const handleExportPdf = async () => {
    const exportNode = exportContentRef.current || screenContentRef.current;
    if (!exportNode || isExporting) return;

    try {
      setIsExporting(true);
      const canvas = await html2canvas(exportNode, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#f6f8fc",
      });

      const imageData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const marginX = 8;
      const imageWidth = pageWidth - marginX * 2;
      const imageHeight = (canvas.height * imageWidth) / canvas.width;
      const headerSpace = 32;
      const pageBottomGap = 8;

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(16);
      pdf.text(companyName || "Your Company", marginX, 10);
      pdf.setFontSize(13);
      pdf.text(`Daily Closing Report - ${formatDateHeader(selectedDate)}`, marginX, 17);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.text(
        `Employee: ${employeeName || "-"}${employeeRole ? ` (${employeeRole})` : ""}`,
        marginX,
        23
      );
      pdf.text(
        `Generated: ${new Date().toLocaleString("en-IN")}`,
        pageWidth - marginX,
        23,
        { align: "right" }
      );
      pdf.setDrawColor(210, 220, 235);
      pdf.line(marginX, 26, pageWidth - marginX, 26);

      pdf.addImage(imageData, "PNG", marginX, headerSpace, imageWidth, imageHeight);

      const firstPageVisibleHeight = pageHeight - headerSpace - pageBottomGap;
      let consumedHeight = firstPageVisibleHeight;
      const nextPageVisibleHeight = pageHeight - 12;

      while (consumedHeight < imageHeight) {
        pdf.addPage();
        pdf.addImage(
          imageData,
          "PNG",
          marginX,
          6 - consumedHeight,
          imageWidth,
          imageHeight
        );
        consumedHeight += nextPageVisibleHeight;
      }

      pdf.save(`daily-closing-report-${selectedDateParam}.pdf`);
    } catch (exportErr) {
      console.error("PDF export failed:", exportErr);
      setError("Failed to export PDF");
    } finally {
      setIsExporting(false);
    }
  };

  const handleMailReport = async () => {
    if (isMailing) return;
    try {
      setIsMailing(true);
      setError("");
      setSuccessMessage("");

      await API.post("/daily-closing/mail-report", {
        selectedDate: selectedDateParam,
        keyHighlights,
        meetingsCompleted: completedMeetings.map((m) => ({
          clientName: m.clientName || "",
          notes: m.notes || "",
          status: m.status || "",
          type: "Meeting",
        })),
        followupsCompleted: completedFollowups.map((f) => ({
          clientName: f.clientName || "",
          notes: f.notes || f.title || "",
          status: f.status || "",
          type: "Follow-up",
        })),
        meetingsCancelled: cancelledMeetings.map((m) => ({
          clientName: m.clientName || "",
          notes: m.notes || "",
          status: m.status || "",
          type: "Meeting",
        })),
        followupsCancelled: cancelledFollowups.map((f) => ({
          clientName: f.clientName || "",
          notes: f.notes || f.title || "",
          status: f.status || "",
          type: "Follow-up",
        })),
      });

      setSuccessMessage("Report mailed successfully");
    } catch (mailErr) {
      console.error("Mail report failed:", mailErr);
      setError(mailErr?.response?.data?.message || "Failed to mail report");
    } finally {
      setIsMailing(false);
    }
  };

  return (
    <div className="dailyClosingPage">
      <section className="dailyClosingFormSection dailyClosingFormSectionStandalone">
        <div className="dailyClosingReportHeader">
          <h2 className="dailyClosingFormTitle">Daily Closing Report - {formatDateHeader(selectedDate)}</h2>
          <div className="dailyClosingFormActions dailyClosingReportActions">
            <button
              className="dailyClosingBtn dailyClosingBtnSuccess"
              type="button"
              onClick={handleMailReport}
              disabled={isMailing}
            >
              {isMailing ? "Mailing..." : "Mail This Report"}
            </button>
            <button
              className="dailyClosingBtn dailyClosingBtnPrimary"
              type="button"
              onClick={handleExportPdf}
              disabled={isExporting}
            >
              {isExporting ? "Exporting..." : "Export to PDF"}
            </button>
          </div>
        </div>

        {error ? <div className="dailyClosingSubmitMessage">{error}</div> : null}
        {successMessage ? <div className="dailyClosingSubmitMessage">{successMessage}</div> : null}

        <div className="dailyClosingReportCard" ref={screenContentRef}>
          <ReportTableSection
            title="Meeting Details (Completed)"
            loading={loading}
            emptyText="No completed meetings found for this date."
            rows={completedMeetings}
            selectedStatus="completed"
            onStatusChange={() => {}}
            hideStatusToggle
          />
          <ReportTableSection
            title="Follow-up Details (Completed)"
            loading={loading}
            emptyText="No completed follow-ups found for this date."
            rows={completedFollowups}
            selectedStatus="completed"
            onStatusChange={() => {}}
            getTotalEvents={() => 1}
            hideStatusToggle
            detailsHeader="Agenda of Meeting"
          />
          <ReportTableSection
            title="Meeting Details (Cancelled)"
            loading={loading}
            emptyText="No cancelled meetings found for this date."
            rows={cancelledMeetings}
            selectedStatus="cancelled"
            onStatusChange={() => {}}
            hideStatusToggle
          />
          <ReportTableSection
            title="Follow-up Details (Cancelled)"
            loading={loading}
            emptyText="No cancelled follow-ups found for this date."
            rows={cancelledFollowups}
            selectedStatus="cancelled"
            onStatusChange={() => {}}
            getTotalEvents={() => 1}
            hideStatusToggle
            detailsHeader="Agenda of Meeting"
          />

          <div className="dailyClosingReportHighlights">
            <strong>Key Highlights</strong>
            <span>{keyHighlights || "-"}</span>
          </div>

          <div className="dailyClosingReportMeta">
            <span>Date: {selectedDateParam}</span>
            <span>Meetings: {meetings.length}</span>
            <span>Follow-ups: {followups.length}</span>
          </div>
        </div>

        <div className="dailyClosingPdfExportOnly" ref={exportContentRef}>
          <div className="dailyClosingReportCard">
            <ReportTableSection
              title="Meeting Details (Completed)"
              loading={false}
              emptyText="No completed meetings found for this date."
              rows={completedMeetings}
              selectedStatus="completed"
              onStatusChange={() => {}}
              hideStatusToggle
              expandMinutesByDefault
              showExpandControl={false}
            />
            <ReportTableSection
              title="Follow-up Details (Completed)"
              loading={false}
              emptyText="No completed follow-ups found for this date."
              rows={completedFollowups}
              selectedStatus="completed"
              onStatusChange={() => {}}
              getTotalEvents={() => 1}
              hideStatusToggle
              expandMinutesByDefault
              showExpandControl={false}
              detailsHeader="Agenda of Meeting"
            />
            <ReportTableSection
              title="Meeting Details (Cancelled)"
              loading={false}
              emptyText="No cancelled meetings found for this date."
              rows={cancelledMeetings}
              selectedStatus="cancelled"
              onStatusChange={() => {}}
              hideStatusToggle
              expandMinutesByDefault
              showExpandControl={false}
            />
            <ReportTableSection
              title="Follow-up Details (Cancelled)"
              loading={false}
              emptyText="No cancelled follow-ups found for this date."
              rows={cancelledFollowups}
              selectedStatus="cancelled"
              onStatusChange={() => {}}
              getTotalEvents={() => 1}
              hideStatusToggle
              expandMinutesByDefault
              showExpandControl={false}
              detailsHeader="Agenda of Meeting"
            />

            <div className="dailyClosingReportHighlights">
              <strong>Key Highlights</strong>
              <span>{keyHighlights || "-"}</span>
            </div>

            <div className="dailyClosingReportMeta">
              <span>Date: {selectedDateParam}</span>
              <span>Meetings: {meetings.length}</span>
              <span>Follow-ups: {followups.length}</span>
            </div>
          </div>
        </div>

        <div className="dailyClosingFormActions">
          <button
            type="button"
            className="dailyClosingBtn dailyClosingBtnGhost"
            onClick={() => navigate("/calendar")}
          >
            Back to Main Calendar
          </button>
        </div>
      </section>
    </div>
  );
}
