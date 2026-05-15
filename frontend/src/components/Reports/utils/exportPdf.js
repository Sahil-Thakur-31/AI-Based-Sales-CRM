import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";

function sanitizeFileName(value) {
  return String(value || "report")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "report";
}

function buildExportContainer(element, title) {
  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.left = "-100000px";
  wrapper.style.top = "0";
  wrapper.style.width = `${Math.max(element.scrollWidth, 1100)}px`;
  wrapper.style.background = "#ffffff";
  wrapper.style.padding = "24px";
  wrapper.style.zIndex = "-1";

  const heading = document.createElement("h1");
  heading.textContent = title;
  heading.style.margin = "0 0 18px";
  heading.style.fontFamily = '"Segoe UI", Arial, sans-serif';
  heading.style.fontSize = "24px";
  heading.style.fontWeight = "700";
  heading.style.color = "#0b2142";

  const clone = element.cloneNode(true);
  clone.querySelectorAll("button, select, input").forEach((node) => {
    node.style.display = "none";
  });

  wrapper.appendChild(heading);
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);
  return wrapper;
}

export async function exportReportElementAsPdf({ element, title = "Report" }) {
  if (!element) return;

  const exportContainer = buildExportContainer(element, title);

  try {
    const canvas = await html2canvas(exportContainer, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
      logging: false,
      windowWidth: exportContainer.scrollWidth,
      windowHeight: exportContainer.scrollHeight,
    });

    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF("l", "mm", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const usableWidth = pageWidth - margin * 2;
    const usableHeight = pageHeight - margin * 2;
    const imageHeight = (canvas.height * usableWidth) / canvas.width;

    let remainingHeight = imageHeight;
    let positionY = margin;

    pdf.addImage(imgData, "PNG", margin, positionY, usableWidth, imageHeight, undefined, "FAST");
    remainingHeight -= usableHeight;

    while (remainingHeight > 0) {
      pdf.addPage();
      positionY = margin - (imageHeight - remainingHeight);
      pdf.addImage(imgData, "PNG", margin, positionY, usableWidth, imageHeight, undefined, "FAST");
      remainingHeight -= usableHeight;
    }

    pdf.save(`${sanitizeFileName(title)}.pdf`);
  } finally {
    if (exportContainer.parentNode) {
      exportContainer.parentNode.removeChild(exportContainer);
    }
  }
}
