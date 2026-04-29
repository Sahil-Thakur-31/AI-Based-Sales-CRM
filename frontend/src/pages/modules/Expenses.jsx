import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import API from "../../api";
import FormErrorSlot from "../../components/FormErrorSlot";
import "./styles/Expense.css";

const categories = [
  { label: "Travel", value: "travel" },
  { label: "Food", value: "food" },
  { label: "Hotel", value: "hotel" },
  { label: "Stationery", value: "stationery" },
  { label: "Other Expense", value: "other" },
];

const normalizeExpenseCategory = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["travel", "food", "hotel", "stationery", "other"].includes(normalized)) {
    return normalized;
  }
  if (normalized === "client_meeting") return "food";
  if (["marketing", "event", "medical"].includes(normalized)) return "other";
  return "other";
};

const getOcrCustomCategory = (fields = {}, meta = {}) => {
  const suggestedCategory = normalizeExpenseCategory(
    fields.suggestedExpenseCategory || fields.predictedCategory || meta?.predictedCategory
  );
  if (suggestedCategory !== "other") {
    return "";
  }

  const predictedCategory = String(fields.predictedCategory || meta?.predictedCategory || "").trim();
  if (!predictedCategory || predictedCategory.toLowerCase() === "other") {
    return "";
  }

  return predictedCategory
    .replace(/[_-]+/g, " ")
    .replace(/\b([a-z])/g, (match) => match.toUpperCase())
    .trim();
};

const inferCategoryFromOcrText = (fields = {}, meta = {}) => {
  const explicitCategory =
    fields.suggestedExpenseCategory ||
    fields.predictedCategory ||
    meta?.suggestedExpenseCategory ||
    meta?.predictedCategory;
  if (explicitCategory) {
    return normalizeExpenseCategory(explicitCategory);
  }

  const text = [
    fields.vendorName,
    fields.description,
    fields.rawText,
    meta?.rawText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!text.trim()) {
    return "other";
  }

  const hasAny = (terms) => terms.some((term) => text.includes(term));
  const lodgingTerms = ["hotel stay", "room booking", "room rent", "accommodation", "check in", "check-in", "lodging", "resort"];
  const foodTerms = ["restaurant", "food", "meal", "breakfast", "lunch", "dinner", "snack", "cafe", "coffee", "tea", "pizza", "burger", "sweets", "juice", "kitchen", "dining", "dhaba", "biryani", "thali", "panchalee"];

  if (hasAny(foodTerms) || (text.includes("hotel") && !hasAny(lodgingTerms))) {
    return "food";
  }
  if (hasAny(lodgingTerms)) {
    return "hotel";
  }
  if (hasAny(["travel", "trip", "taxi", "cab", "uber", "ola", "bus", "train", "flight", "fuel", "petrol", "diesel", "parking", "toll", "metro"])) {
    return "travel";
  }
  if (hasAny(["stationery", "stationary", "office supply", "notebook", "pen", "pencil", "paper", "printout", "print", "xerox", "copy", "cartridge", "marker"])) {
    return "stationery";
  }

  return "other";
};

const ExpenseDashboard = () => {
  const now = new Date();
  const currentYear = String(now.getFullYear());
  const currentMonth = String(now.getMonth() + 1).padStart(2, "0");
  const totalPeriodLabel = now.toLocaleString("en-US", { month: "short", year: "numeric" });
  const [selectedUser, setSelectedUser] = useState("All Users");
  const [search, setSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [showLogModal, setShowLogModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectingExpense, setRejectingExpense] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showReasonModal, setShowReasonModal] = useState(false);
  const [reasonExpense, setReasonExpense] = useState(null);
  const [pageError, setPageError] = useState("");
  const [logFormError, setLogFormError] = useState("");
  const [rejectFormError, setRejectFormError] = useState("");
  const [ocrFormError, setOcrFormError] = useState("");
  const [ocrReceipts, setOcrReceipts] = useState([]);
  const [ocrSelectedId, setOcrSelectedId] = useState(null);
  const [ocrPreviewUrl, setOcrPreviewUrl] = useState("");
  const [ocrImageAdjustments, setOcrImageAdjustments] = useState({});
  const [ocrProcessing, setOcrProcessing] = useState(false);
  const [ocrResultMeta, setOcrResultMeta] = useState(null);
  const [appliedReceiptOcrData, setAppliedReceiptOcrData] = useState(null);
  const [ocrCropInteraction, setOcrCropInteraction] = useState(null);
  const ocrPreviewStageRef = useRef(null);

  const [expenses, setExpenses] = useState([]);
  const [usersList, setUsersList] = useState(["All Users"]);
  const [currentUser, setCurrentUser] = useState(null);
  const [editingExpense, setEditingExpense] = useState(null);
  const [viewingExpense, setViewingExpense] = useState(null);
  const [receiptFiles, setReceiptFiles] = useState([]);
  const [formReceiptPreviewUrl, setFormReceiptPreviewUrl] = useState("");

  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const [userSummarySearch, setUserSummarySearch] = useState("");
  const [userSummaryPage, setUserSummaryPage] = useState(1);
  const userSummaryPageSize = 5;

  const [formData, setFormData] = useState({
    category: "travel",
    otherCategory: "",
    vendorName: "",
    referenceType: "Lead",
    date: "",
    total: "",
    description: "",
  });

  const roleName = String(currentUser?.role?.name || localStorage.getItem("RoleName") || "").toLowerCase();
  const isAdmin = roleName === "admin";

  const dynamicCategories = React.useMemo(() => {
    const baseCategories = [
      { label: "Travel", value: "travel" },
      { label: "Food", value: "food" },
      { label: "Hotel", value: "hotel" },
      { label: "Stationery", value: "stationery" },
      { label: "Other Expense", value: "other" },
    ];

    const predictedCategory = String(
      appliedReceiptOcrData?.fields?.predictedCategory || ocrResultMeta?.predictedCategory || ""
    ).trim();
    const normalizedValue = predictedCategory.toLowerCase();
    const knownCategoryValues = baseCategories.map((item) => item.value);

    if (normalizedValue && !knownCategoryValues.includes(normalizedValue)) {
      const predictedLabel = predictedCategory
        .replace(/[_-]+/g, " ")
        .replace(/\b([a-z])/g, (match) => match.toUpperCase())
        .trim();
      baseCategories.push({ label: `${predictedLabel} (Suggested)`, value: "other" });
    }

    return baseCategories;
  }, [appliedReceiptOcrData, ocrResultMeta]);

  const resetForm = () => {
    setFormData({
      category: "travel",
      otherCategory: "",
      vendorName: "",
      referenceType: "Lead",
      date: "",
      total: "",
      description: "",
    });
    setEditingExpense(null);
    setReceiptFiles([]);
    setLogFormError("");
    setAppliedReceiptOcrData(null);
  };

  const resetOcrModal = () => {
    setOcrReceipts([]);
    setOcrSelectedId(null);
    setOcrPreviewUrl("");
    setOcrImageAdjustments({});
    setOcrProcessing(false);
    setOcrResultMeta(null);
    setOcrFormError("");
    setOcrCropInteraction(null);
  };

  const fetchCurrentUser = async () => {
    try {
      const { data } = await API.get("/users/me");
      setCurrentUser(data);
    } catch (err) {
      console.error("Fetch current user error:", err);
    }
  };

  const fetchExpenses = async () => {
    try {
      const { data } = await API.get("/api/expenses");

      const formatted = data.map((exp) => ({
        receipts:
          Array.isArray(exp.receipts) && exp.receipts.length > 0
            ? exp.receipts
            : exp.receipt?.fileUrl && exp.receipt.fileUrl !== "dummy-url"
              ? [exp.receipt]
              : [],
        id: exp._id,
        category: normalizeExpenseCategory(exp.category),
        otherCategory: exp.otherCategory || "",
        vendorName: exp.vendorName || exp.receipt?.extractedData?.vendor || "",
        categoryLabel:
          normalizeExpenseCategory(exp.category) === "other"
            ? exp.otherCategory || "Other Expense"
            : categories.find((c) => c.value === normalizeExpenseCategory(exp.category))?.label || exp.category,
        user: exp.userId?.name || "Unknown",
        userId: exp.userId?._id,
        amount: Number(exp.amount || 0),
        gst: Number(exp.gstAmount || 0),
        total: Number(exp.totalAmount || 0),
        date: exp.expenseDate ? exp.expenseDate.split("T")[0] : "",
        status: exp.approval?.status || "pending",
        approvalRemarks: exp.approval?.remarks || "",
        description: exp.description || "",
        referenceId: exp.referenceId,
        referenceType: exp.referenceType,
        receipt: exp.receipt,
        updatedAt: exp.updatedAt,
      }));

      setExpenses(formatted);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchUsers = async () => {
    if (!isAdmin) {
      setUsersList(["All Users"]);
      return;
    }

    try {
      const { data } = await API.get("/users");
      const users = ["All Users", ...data.map((user) => user.name)];
      setUsersList(users);
    } catch (err) {
      console.error("Users fetch error:", err);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCurrentUser();
    fetchExpenses();
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchUsers();
  }, [isAdmin]);

  const filteredUsers = usersList.filter((user) =>
    user.toLowerCase().includes(search.toLowerCase())
  );

  const filteredExpenses =
    isAdmin && selectedUser !== "All Users"
      ? expenses.filter((exp) => exp.user === selectedUser)
      : expenses;

  const sortedExpenses = [...filteredExpenses].sort((a, b) => {
    const aTime = new Date(a.updatedAt || a.date || 0).getTime();
    const bTime = new Date(b.updatedAt || b.date || 0).getTime();
    return bTime - aTime;
  });

  const totalAmount = filteredExpenses
    .filter((e) => {
      const date = e.date || "";
      if (!date) return false;
      const year = date.slice(0, 4);
      const month = date.slice(5, 7);
      return year === currentYear && month === currentMonth;
    })
    .reduce((sum, e) => sum + e.total, 0);
  const approved = sortedExpenses.filter((e) => e.status === "approved");
  const pending = sortedExpenses.filter((e) => e.status === "pending");
  const approvedFilteredExpenses = filteredExpenses.filter((e) => e.status === "approved");

  const categorySummary = categories.map((cat) => {
    const total = approvedFilteredExpenses
      .filter((e) => e.category === cat.value)
      .reduce((sum, e) => sum + e.total, 0);
    return { category: cat.label, total };
  });

  const maxCategory = Math.max(...categorySummary.map((c) => c.total), 1);

  let userSummary = [];
  if (isAdmin) {
    const grouped = {};

    for (const exp of approvedFilteredExpenses) {
      if (!grouped[exp.user]) {
        grouped[exp.user] = {
          user: exp.user,
          total: 0,
          latestUpdate: exp.updatedAt || exp.date,
        };
      }

      grouped[exp.user].total += exp.total;
      const currentLatest = new Date(grouped[exp.user].latestUpdate || 0).getTime();
      const candidate = new Date(exp.updatedAt || exp.date || 0).getTime();
      if (candidate > currentLatest) {
        grouped[exp.user].latestUpdate = exp.updatedAt || exp.date;
      }
    }

    userSummary = Object.values(grouped).sort(
      (a, b) => new Date(b.latestUpdate || 0).getTime() - new Date(a.latestUpdate || 0).getTime()
    );
  }

  const maxUser = Math.max(...userSummary.map((u) => u.total), 1);
  const filteredUserSummary = userSummary.filter((item) =>
    item.user.toLowerCase().includes(userSummarySearch.toLowerCase())
  );
  const userSummaryTotalPages = Math.max(
    1,
    Math.ceil(filteredUserSummary.length / userSummaryPageSize)
  );
  const paginatedUserSummary = filteredUserSummary.slice(
    (userSummaryPage - 1) * userSummaryPageSize,
    userSummaryPage * userSummaryPageSize
  );

  const totalPages = Math.max(1, Math.ceil(sortedExpenses.length / pageSize));
  const paginatedExpenses = sortedExpenses.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedUser]);

  useEffect(() => {
    setUserSummaryPage(1);
  }, [userSummarySearch, selectedUser, expenses]);

  useEffect(() => {
    const selectedReceipt = ocrReceipts.find((item) => item.id === ocrSelectedId);
    if (!selectedReceipt) {
      setOcrPreviewUrl("");
      return undefined;
    }

    const objectUrl = URL.createObjectURL(selectedReceipt.file);
    setOcrPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [ocrReceipts, ocrSelectedId]);

  useEffect(() => {
    const firstReceipt = receiptFiles[0];
    if (!firstReceipt) {
      setFormReceiptPreviewUrl("");
      return undefined;
    }

    const objectUrl = URL.createObjectURL(firstReceipt);
    setFormReceiptPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [receiptFiles]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "category") {
      setFormData({
        ...formData,
        category: value,
        otherCategory: value === "other" ? formData.otherCategory : "",
      });
      return;
    }
    setFormData({ ...formData, [name]: value });
  };

  const openCreateModal = () => {
    resetForm();
    setPageError("");
    setShowLogModal(true);
  };

  const openOcrModal = () => {
    resetOcrModal();
    setShowModal(true);
  };

  const closeOcrModal = () => {
    setShowModal(false);
    resetOcrModal();
  };

  const openEditModal = (expense) => {
    setLogFormError("");
    setPageError("");
    setEditingExpense(expense);
    setFormData({
      category: normalizeExpenseCategory(expense.category),
      otherCategory: expense.otherCategory || "",
      vendorName: expense.vendorName || "",
      referenceType: expense.referenceType || "Lead",
      date: expense.date,
      total: String(expense.total),
      description: expense.description || "",
    });
    setReceiptFiles([]);
    setShowLogModal(true);
  };

  const handleSubmitExpense = async () => {
    if (!currentUser) {
      setLogFormError("User not loaded yet");
      return;
    }

    if (!formData.total || !formData.date) {
      setLogFormError("Fill required fields");
      return;
    }

    if (formData.category === "other" && !formData.otherCategory.trim()) {
      setLogFormError("Please enter other expense category");
      return;
    }

    const totalAmount = Number(formData.total);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      setLogFormError("Total amount must be greater than 0");
      return;
    }

    setLogFormError("");

    const payload = new FormData();
    payload.append("category", formData.category);
    payload.append(
      "otherCategory",
      formData.category === "other" ? formData.otherCategory.trim() : ""
    );
    payload.append("vendorName", formData.vendorName || "");
    payload.append("amount", String(Number(totalAmount.toFixed(2))));
    payload.append("gstAmount", "0");
    payload.append("totalAmount", String(Number(totalAmount.toFixed(2))));
    payload.append("expenseDate", formData.date);
    payload.append("description", formData.description || "");
    payload.append("referenceId", editingExpense?.referenceId || currentUser._id);
    payload.append("referenceType", formData.referenceType || "Lead");
    if (appliedReceiptOcrData) {
      payload.append("receiptOcrData", JSON.stringify(appliedReceiptOcrData));
    }

    if (receiptFiles.length > 0) {
      receiptFiles.forEach((file) => payload.append("receipts", file));
    }

    if (editingExpense) {
      const existingUrls = (editingExpense.receipts || [])
        .map((item) => item?.fileUrl)
        .filter((url) => url && url !== "dummy-url");
      payload.append("existingReceiptUrls", JSON.stringify(existingUrls));
    }

    try {
      if (editingExpense) {
        await API.put(`/api/expenses/${editingExpense.id}`, payload);
      } else {
        payload.append("userId", currentUser._id);
        await API.post("/api/expenses", payload);
      }

      await fetchExpenses();
      setShowLogModal(false);
      resetForm();
      setPageError("");
    } catch (err) {
      console.error(err);
      setLogFormError(err.response?.data?.message || "Failed to save expense");
    }
  };

  const handleDelete = async (id) => {
    try {
      await API.delete(`/api/expenses/${id}`);
      await fetchExpenses();
      setPageError("");
    } catch (err) {
      console.error(err);
      setPageError(err.response?.data?.message || "Failed to delete expense");
    }
  };

  const handleStatusChange = async (expense, status) => {
    if (!isAdmin || status === expense.status) {
      return;
    }

    if (status === "rejected") {
      setRejectingExpense(expense);
      setRejectReason("");
      setRejectFormError("");
      setShowRejectModal(true);
      return;
    }

    try {
      await API.put(`/api/expenses/status/${expense.id}`, {
        status,
        reason: "",
      });
      await fetchExpenses();
      setPageError("");
    } catch (err) {
      console.error(err);
      setPageError(err.response?.data?.message || "Failed to update status");
    }
  };

  const closeRejectModal = () => {
    setShowRejectModal(false);
    setRejectingExpense(null);
    setRejectReason("");
    setRejectFormError("");
  };

  const openReasonModal = (expense) => {
    if (expense.status !== "rejected" || !expense.approvalRemarks) return;
    setReasonExpense(expense);
    setShowReasonModal(true);
  };

  const closeReasonModal = () => {
    setShowReasonModal(false);
    setReasonExpense(null);
  };

  const submitRejectReason = async () => {
    if (!rejectingExpense) return;

    const trimmedReason = rejectReason.trim();
    if (!trimmedReason) {
      setRejectFormError("Reject reason is required");
      return;
    }
    setRejectFormError("");

    try {
      await API.put(`/api/expenses/status/${rejectingExpense.id}`, {
        status: "rejected",
        reason: trimmedReason,
      });
      await fetchExpenses();
      closeRejectModal();
      setPageError("");
    } catch (err) {
      console.error(err);
      setRejectFormError(err.response?.data?.message || "Failed to update status");
    }
  };

  const handleView = (expense) => {
    setViewingExpense(expense);
    setShowViewModal(true);
  };

  const getReceiptUrl = (fileUrl) => {
    if (!fileUrl) return "";
    if (/^https?:\/\//i.test(fileUrl)) return encodeURI(fileUrl);
    const base = String(API.defaults.baseURL || "").replace(/\/+$/, "");
    const normalizedPath = fileUrl.startsWith("/")
      ? fileUrl
      : `/uploads/${fileUrl}`;
    return encodeURI(`${base}${normalizedPath}`);
  };

  const selectedOcrReceipt = ocrReceipts.find((item) => item.id === ocrSelectedId) || null;

  const getOcrAdjustment = (id) =>
    ocrImageAdjustments[id] || {
      rotation: 0,
      brightness: 100,
      contrast: 100,
      cropRect: null,
    };

  const selectedOcrAdjustment = selectedOcrReceipt
    ? getOcrAdjustment(selectedOcrReceipt.id)
    : {
      rotation: 0,
      brightness: 100,
      contrast: 100,
      cropRect: null,
    };

  const updateOcrAdjustment = (id, key, value) => {
    setOcrImageAdjustments((prev) => ({
      ...prev,
      [id]: {
        ...getOcrAdjustment(id),
        [key]: value,
      },
    }));
  };

  const resetOcrAdjustment = (id) => {
    setOcrImageAdjustments((prev) => ({
      ...prev,
      [id]: {
        rotation: 0,
        brightness: 100,
        contrast: 100,
        cropRect: null,
      },
    }));
    setOcrCropInteraction(null);
  };

  const normalizeCropRect = (area) => {
    if (!area) return null;
    const startX = Number(area.x) || 0;
    const startY = Number(area.y) || 0;
    const endX = startX + (Number(area.width) || 0);
    const endY = startY + (Number(area.height) || 0);
    const left = Math.max(0, Math.min(100, Math.min(startX, endX)));
    const top = Math.max(0, Math.min(100, Math.min(startY, endY)));
    const right = Math.max(0, Math.min(100, Math.max(startX, endX)));
    const bottom = Math.max(0, Math.min(100, Math.max(startY, endY)));
    return {
      x: left,
      y: top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  };

  const getCropPointer = (event) => {
    if (!ocrPreviewStageRef.current) return null;
    const bounds = ocrPreviewStageRef.current.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;

    return {
      x: Math.max(0, Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100)),
      y: Math.max(0, Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100)),
    };
  };

  const isPointInsideCrop = (point, cropRect) =>
    Boolean(
      point &&
      cropRect &&
      point.x >= cropRect.x &&
      point.x <= cropRect.x + cropRect.width &&
      point.y >= cropRect.y &&
      point.y <= cropRect.y + cropRect.height
    );

  const startCropSelection = (event) => {
    if (!selectedOcrReceipt || selectedOcrReceipt.isPdf) return;
    const pointer = getCropPointer(event);
    if (!pointer) return;

    const currentCrop = normalizeCropRect(selectedOcrAdjustment.cropRect);
    const mode = isPointInsideCrop(pointer, currentCrop) ? "move" : "draw";

    if (mode === "draw") {
      updateOcrAdjustment(selectedOcrReceipt.id, "cropRect", {
        x: pointer.x,
        y: pointer.y,
        width: 0,
        height: 0,
      });
    }

    setOcrCropInteraction({
      mode,
      startPoint: pointer,
      startRect: currentCrop,
      offset: currentCrop
        ? {
            x: pointer.x - currentCrop.x,
            y: pointer.y - currentCrop.y,
          }
        : null,
    });
  };

  const updateCropSelection = (event) => {
    if (!ocrCropInteraction || !selectedOcrReceipt || selectedOcrReceipt.isPdf) return;
    const pointer = getCropPointer(event);
    if (!pointer) return;

    if (ocrCropInteraction.mode === "draw") {
      updateOcrAdjustment(
        selectedOcrReceipt.id,
        "cropRect",
        normalizeCropRect({
          x: ocrCropInteraction.startPoint.x,
          y: ocrCropInteraction.startPoint.y,
          width: pointer.x - ocrCropInteraction.startPoint.x,
          height: pointer.y - ocrCropInteraction.startPoint.y,
        })
      );
      return;
    }

    if (ocrCropInteraction.mode === "move" && ocrCropInteraction.startRect) {
      const width = ocrCropInteraction.startRect.width;
      const height = ocrCropInteraction.startRect.height;
      const nextRect = normalizeCropRect({
        x: pointer.x - (ocrCropInteraction.offset?.x || 0),
        y: pointer.y - (ocrCropInteraction.offset?.y || 0),
        width,
        height,
      });
      updateOcrAdjustment(selectedOcrReceipt.id, "cropRect", {
        ...nextRect,
        x: Math.min(nextRect.x, 100 - width),
        y: Math.min(nextRect.y, 100 - height),
      });
    }
  };

  const endCropSelection = () => {
    if (!selectedOcrReceipt) {
      setOcrCropInteraction(null);
      return;
    }
    const finalCrop = normalizeCropRect(getOcrAdjustment(selectedOcrReceipt.id).cropRect);
    if (finalCrop && (finalCrop.width < 3 || finalCrop.height < 3)) {
      updateOcrAdjustment(selectedOcrReceipt.id, "cropRect", null);
    }
    setOcrCropInteraction(null);
  };

  const handleOcrReceiptSelect = (event) => {
    const incoming = Array.from(event.target.files || []);
    if (incoming.length === 0) return;

    const validFiles = incoming.filter(
      (file) =>
        String(file.type || "").startsWith("image/") || file.type === "application/pdf"
    );

    if (validFiles.length !== incoming.length) {
      setOcrFormError("Only image and PDF files are allowed.");
    } else {
      setOcrFormError("");
    }
    setOcrResultMeta(null);
    setOcrCropInteraction(null);

    const mapped = validFiles.map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      file,
      name: file.name,
      isPdf: file.type === "application/pdf",
    }));

    setOcrReceipts((prev) => {
      const merged = [...prev];
      mapped.forEach((item) => {
        if (!merged.some((existing) => existing.id === item.id)) {
          merged.push(item);
        }
      });
      return merged;
    });

    const nextSelected = mapped[0]?.id || ocrSelectedId;
    if (nextSelected) {
      setOcrSelectedId(nextSelected);
    }

    event.target.value = "";
  };

  const handleRemoveOcrReceipt = (idToRemove) => {
    setOcrReceipts((prev) => {
      const next = prev.filter((item) => item.id !== idToRemove);
      if (ocrSelectedId === idToRemove) {
        setOcrSelectedId(next[0]?.id || null);
      }
      return next;
    });
  };

  const applyOcrToExpenseForm = (fields, meta) => {
    const suggestedCategory = inferCategoryFromOcrText(fields, meta);
    const customCategory = getOcrCustomCategory(fields, meta);
    const vendorName = String(fields.vendorName || "").trim();
    const descriptionParts = [];

    if (vendorName) {
      descriptionParts.push(`Vendor: ${vendorName}`);
    }
    if (String(fields.description || "").trim()) {
      descriptionParts.push(String(fields.description || "").trim());
    }

    setReceiptFiles(ocrReceipts.map((item) => item.file));
    setAppliedReceiptOcrData({
      fields: {
        vendorName,
        expenseDate: fields.expenseDate || "",
        totalAmount:
          fields.totalAmount !== null && fields.totalAmount !== undefined
            ? Number(fields.totalAmount)
            : null,
        description: String(fields.description || "").trim(),
        currencyCode: fields.currencyCode || meta?.currencyCode || "INR",
        predictedCategory: fields.predictedCategory || meta?.predictedCategory || "",
        suggestedExpenseCategory: fields.suggestedExpenseCategory || meta?.suggestedExpenseCategory || "",
        rawText: fields.rawText || meta?.rawText || "",
      },
      overallConfidence: meta?.overallConfidence || 0,
    });

    setFormData((prev) => ({
      ...prev,
      category: suggestedCategory,
      otherCategory: suggestedCategory === "other" ? customCategory || prev.otherCategory : "",
      vendorName: vendorName || prev.vendorName,
      date: fields.expenseDate || prev.date,
      total:
        fields.totalAmount !== null && fields.totalAmount !== undefined
          ? String(fields.totalAmount)
          : prev.total,
      description: descriptionParts.join("\n") || prev.description,
    }));

    const feedback = [...(meta?.validation || []), ...(meta?.warnings || [])]
      .filter(Boolean)
      .join(" ");
    setLogFormError(feedback);

    setShowModal(false);
    setShowLogModal(true);
  };

  const handleRunExpenseOcr = async () => {
    if (!selectedOcrReceipt) {
      setOcrFormError("Upload a receipt before running OCR.");
      return;
    }

    const adjustment = getOcrAdjustment(selectedOcrReceipt.id);
    const payload = new FormData();
    payload.append("receipt", selectedOcrReceipt.file);
    payload.append("rotation", String(adjustment.rotation || 0));
    payload.append("brightness", String(adjustment.brightness || 100));
    payload.append("contrast", String(adjustment.contrast || 100));
    if (adjustment.cropRect) {
      payload.append("cropRect", JSON.stringify(adjustment.cropRect));
    }

    try {
      setOcrProcessing(true);
      setOcrFormError("");
      const { data } = await API.post("/api/expenses/ocr/extract", payload);
      const fields = data?.fields || {};
      const nextMeta = {
        overallConfidence: data?.overallConfidence || 0,
        warnings: data?.warnings || [],
        validation: data?.validation || [],
        predictedCategory:
          data?.fields?.predictedCategory || data?.predictedCategory || data?.metadata?.predictedCategory || "",
        suggestedExpenseCategory:
          data?.fields?.suggestedExpenseCategory || data?.suggestedExpenseCategory || data?.metadata?.suggestedExpenseCategory || "",
        currencyCode: data?.fields?.currencyCode || data?.metadata?.currencyCode || "INR",
        rawText: data?.rawText || "",
      };
      setOcrResultMeta(nextMeta);
      applyOcrToExpenseForm(fields, nextMeta);
    } catch (error) {
      setOcrResultMeta(null);
      setOcrFormError(error.response?.data?.message || "Failed to process receipt OCR.");
    } finally {
      setOcrProcessing(false);
    }
  };

  const handleReceiptSelect = (event) => {
    const incoming = Array.from(event.target.files || []);
    if (incoming.length === 0) return;

    const validFiles = incoming.filter(
      (file) =>
        String(file.type || "").startsWith("image/") || file.type === "application/pdf"
    );

    if (validFiles.length !== incoming.length) {
      setLogFormError("Only image and PDF files are allowed.");
    }

    setReceiptFiles((prev) => {
      const map = new Map();
      [...prev, ...validFiles].forEach((file) => {
        const key = `${file.name}-${file.size}-${file.lastModified}`;
        map.set(key, file);
      });
      return Array.from(map.values());
    });

    event.target.value = "";
  };

  const handleRemoveReceipt = (indexToRemove) => {
    setReceiptFiles((prev) => prev.filter((_, index) => index !== indexToRemove));
  };

  const existingReceiptPreviewPath =
    editingExpense?.receipts?.find((item) => item?.fileUrl)?.fileUrl ||
    editingExpense?.receipt?.fileUrl ||
    "";
  const formReceiptPreviewSource = formReceiptPreviewUrl || getReceiptUrl(existingReceiptPreviewPath);
  const formReceiptPreviewName =
    receiptFiles[0]?.name ||
    (existingReceiptPreviewPath ? existingReceiptPreviewPath.split("/").pop() : "");
  const formReceiptPreviewIsPdf =
    receiptFiles[0]?.type === "application/pdf" ||
    /\.pdf(?:$|\?)/i.test(formReceiptPreviewSource);

  return (
    <div className="expense-dashboard">
      <div className="expense-cards">
        <div className="expense-card green">
          <h4>Total</h4>
          <h2>Rs. {totalAmount.toFixed(2)}</h2>
          <p className="expense-total-period">{totalPeriodLabel}</p>
        </div>

        <div className="expense-card blue">
          <h4>Approved</h4>
          <h2>Rs. {approved.reduce((s, e) => s + e.total, 0).toFixed(2)}</h2>
          <p>{approved.length} expenses</p>
        </div>

        <div className="expense-card orange">
          <h4>Pending</h4>
          <h2>Rs. {pending.reduce((s, e) => s + e.total, 0).toFixed(2)}</h2>
          <p>{pending.length} awaiting</p>
        </div>

        <div className="expense-card pink">
          <h4>Total Entries</h4>
          <h2>{sortedExpenses.length}</h2>
          <p>In current view</p>
        </div>
      </div>

      {isAdmin && (
        <div className="expense-middle-section">
          <div className="expense-box">
            <h3>By Category</h3>
            {categorySummary.map((item, i) => (
              <div key={i}>
                <div className="expense-progress-item">
                  <span>{item.category}</span>
                  <span>Rs. {item.total.toFixed(2)}</span>
                </div>
                <div className="expense-progress">
                  <div
                    className="expense-bar green"
                    style={{ width: `${(item.total / maxCategory) * 100}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>

          <div className="expense-box expense-by-user-box">
            <div className="expense-box-header">
              <h3>By User (Recent Updates)</h3>
              <input
                type="text"
                placeholder="Search user..."
                value={userSummarySearch}
                onChange={(e) => setUserSummarySearch(e.target.value)}
                className="expense-by-user-search"
              />
            </div>
            <div className="expense-by-user-scroll">
              {paginatedUserSummary.length > 0 ? (
                paginatedUserSummary.map((item, i) => (
                  <div key={`${item.user}-${i}`}>
                    <div className="expense-user-row">
                      <span>{item.user}</span>
                      <span>Rs. {item.total.toFixed(2)}</span>
                    </div>
                    <div className="expense-progress">
                      <div
                        className="expense-bar blue"
                        style={{ width: `${(item.total / maxUser) * 100}%` }}
                      ></div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="expense-user-empty">No users found.</div>
              )}
            </div>
            <div className="expense-by-user-pagination">
              <button
                disabled={userSummaryPage === 1}
                onClick={() => setUserSummaryPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </button>
              <span>
                Page {userSummaryPage} of {userSummaryTotalPages}
              </span>
              <button
                disabled={userSummaryPage === userSummaryTotalPages}
                onClick={() =>
                  setUserSummaryPage((p) => Math.min(userSummaryTotalPages, p + 1))
                }
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="expense-ledger">
        <div className="expense-ledger-header">
          <h3>Expense Ledger</h3>

          <div className="expense-ledger-actions">
            {isAdmin && (
              <div className="expense-dropdown">
                <div
                  className="expense-dropdown-selected"
                  onClick={() => setShowDropdown(!showDropdown)}
                >
                  {selectedUser} &#9662;
                </div>

                {showDropdown && (
                  <div className="expense-dropdown-menu">
                    <input
                      className="expense-dropdown-search"
                      type="text"
                      placeholder="Search user..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <div className="expense-dropdown-list">
                      {filteredUsers.map((user, i) => (
                        <div
                          key={i}
                          className="expense-dropdown-item"
                          onClick={() => {
                            setSelectedUser(user);
                            setShowDropdown(false);
                          }}
                        >
                          {user}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <button className="expense-ocr-btn" onClick={openOcrModal}>
              OCR
            </button>

            <button className="expense-log-btn" onClick={openCreateModal}>
              + Log Expense
            </button>
          </div>
        </div>
        <FormErrorSlot message={pageError} className="form-error-slot-global" />

        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Type</th>
              <th>User</th>
              <th>Total</th>
              <th>Date</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedExpenses.map((exp) => {
              const canModifyOwnPending = exp.status === "pending" && String(exp.userId) === String(currentUser?._id);
              return (
                <tr key={exp.id}>
                  <td>{exp.categoryLabel}</td>
                  <td>{exp.referenceType || "-"}</td>
                  <td>{exp.user}</td>
                  <td>Rs. {exp.total.toFixed(2)}</td>
                  <td>{exp.date}</td>
                  <td>
                    {isAdmin ? (
                      <select
                        className={`expense-status-select expense-status-${exp.status}`}
                        value={exp.status}
                        disabled={exp.status === "approved"}
                        title={exp.status === "approved" ? "Approved expense status cannot be changed" : "Update status"}
                        onChange={(e) => handleStatusChange(exp, e.target.value)}
                      >
                        <option value="pending">pending</option>
                        <option value="approved">approved</option>
                        <option value="rejected">rejected</option>
                      </select>
                    ) : (
                      <div className="expense-status-stack">
                        <button
                          type="button"
                          className={
                            exp.status === "approved"
                              ? "expense-approved"
                              : exp.status === "rejected"
                                ? "expense-rejected expense-status-clickable"
                                : "expense-pending"
                          }
                          onClick={() => openReasonModal(exp)}
                          title={exp.status === "rejected" ? "Click to view rejected reason" : ""}
                        >
                          {exp.status}
                        </button>
                        {exp.status === "rejected" && exp.approvalRemarks && (
                          <small className="expense-rejection-inline" title="Click rejected status to view full reason">
                            Click rejected status to view reason
                          </small>
                        )}
                      </div>
                    )}
                  </td>
                  <td>
                    <button className="expense-view" onClick={() => handleView(exp)}>
                      View
                    </button>

                    {isAdmin && (
                      <button className="expense-delete" onClick={() => handleDelete(exp.id)}>
                        Delete
                      </button>
                    )}

                    {!isAdmin && canModifyOwnPending && (
                      <button className="expense-view" onClick={() => openEditModal(exp)}>
                        Edit
                      </button>
                    )}

                    {!isAdmin && canModifyOwnPending && (
                      <button className="expense-delete" onClick={() => handleDelete(exp.id)}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="expense-pagination">
          <button disabled={currentPage === 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>
            Prev
          </button>
          <span>
            Page {currentPage} of {totalPages}
          </span>
          <button disabled={currentPage === totalPages} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}>
            Next
          </button>
        </div>
      </div>

      {showModal &&
        ReactDOM.createPortal(
          <div className="expense-modal-overlay">
            <div className="expense-modal expense-large-modal">
              <div className="expense-modal-header">
                <h3>OCR Expense Import</h3>
                <span className="expense-close-btn" onClick={closeOcrModal}>
                  x
                </span>
              </div>

              <div className="expense-ocr-workspace">
                <div className="expense-ocr-sidebar">
                  <label className="expense-upload-box expense-ocr-dropzone">
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      multiple
                      onChange={handleOcrReceiptSelect}
                    />
                    <p>Drop file or click to upload</p>
                    <span>Supports: JPG, PNG, PDF</span>
                  </label>

                  <div className="expense-ocr-filelist">
                    {ocrReceipts.length === 0 ? (
                      <div className="expense-ocr-empty">No receipt selected yet.</div>
                    ) : (
                      ocrReceipts.map((item, index) => (
                        <div
                          key={item.id}
                          className={
                            item.id === ocrSelectedId
                              ? "expense-selected-receipt-item expense-selected-receipt-item-active"
                              : "expense-selected-receipt-item"
                          }
                          onClick={() => setOcrSelectedId(item.id)}
                        >
                          <span title={item.name}>
                            {index + 1}. {item.name}
                          </span>
                          <button
                            type="button"
                            className="expense-remove-receipt-btn"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleRemoveOcrReceipt(item.id);
                            }}
                          >
                            x
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  {!selectedOcrReceipt?.isPdf && selectedOcrReceipt && (
                    <div className="expense-ocr-toolbar">
                      <div className="expense-ocr-actions-row">
                        <button
                          type="button"
                          className="expense-ocr-tool-btn"
                          onClick={() =>
                            updateOcrAdjustment(
                              selectedOcrReceipt.id,
                              "rotation",
                              (selectedOcrAdjustment.rotation || 0) - 90
                            )
                          }
                        >
                          Rotate Left
                        </button>
                        <button
                          type="button"
                          className="expense-ocr-tool-btn"
                          onClick={() =>
                            updateOcrAdjustment(
                              selectedOcrReceipt.id,
                              "rotation",
                              (selectedOcrAdjustment.rotation || 0) + 90
                            )
                          }
                        >
                          Rotate Right
                        </button>
                        <button
                          type="button"
                          className="expense-ocr-tool-btn"
                          onClick={() => resetOcrAdjustment(selectedOcrReceipt.id)}
                        >
                          Reset
                        </button>
                      </div>

                      <div className="expense-ocr-slider-grid">
                        <label>
                          Brightness
                          <input
                            type="range"
                            min="80"
                            max="160"
                            step="5"
                            value={selectedOcrAdjustment.brightness}
                            onChange={(event) =>
                              updateOcrAdjustment(
                                selectedOcrReceipt.id,
                                "brightness",
                                Number(event.target.value)
                              )
                            }
                          />
                        </label>
                        <label>
                          Contrast
                          <input
                            type="range"
                            min="80"
                            max="180"
                            step="5"
                            value={selectedOcrAdjustment.contrast}
                            onChange={(event) =>
                              updateOcrAdjustment(
                                selectedOcrReceipt.id,
                                "contrast",
                                Number(event.target.value)
                              )
                            }
                          />
                        </label>
                      </div>

                      <div className="expense-ocr-note">
                        <div className="expense-ocr-note-title">📐 Image Cropping Instructions:</div>
                        <ul className="expense-ocr-note-steps">
                          <li><strong>Draw Crop:</strong> Click and drag on the image to select the area containing the receipt text</li>
                          <li><strong>Move Crop:</strong> Drag inside the blue crop box to reposition it</li>
                          <li><strong>Clear Crop:</strong> Use the "Clear Crop" button to reset selection</li>
                          <li><strong>Why Crop?</strong> Focus OCR on relevant text areas for better accuracy</li>
                        </ul>
                      </div>
                    </div>
                  )}
                </div>

                <div className="expense-ocr-preview-panel">
                  <div className="expense-ocr-preview-box">
                    {!selectedOcrReceipt ? (
                      <div className="expense-ocr-preview-empty">
                        Select a receipt to preview and crop it here.
                      </div>
                    ) : selectedOcrReceipt.isPdf ? (
                      <iframe
                        title="OCR receipt preview"
                        src={ocrPreviewUrl}
                        className="expense-ocr-preview-frame"
                      />
                    ) : (
                      <div
                        ref={ocrPreviewStageRef}
                        className="expense-ocr-preview-stage"
                        onMouseDown={startCropSelection}
                        onMouseMove={updateCropSelection}
                        onMouseUp={endCropSelection}
                        onMouseLeave={endCropSelection}
                      >
                        <img
                          src={ocrPreviewUrl}
                          alt="Receipt preview"
                          className="expense-ocr-stage-image"
                          draggable={false}
                          style={{
                            transform: `rotate(${selectedOcrAdjustment.rotation || 0}deg)`,
                            filter: `brightness(${selectedOcrAdjustment.brightness}%) contrast(${selectedOcrAdjustment.contrast}%)`,
                          }}
                        />
                        {selectedOcrAdjustment.cropRect && (
                          <div
                            className="expense-ocr-crop-rect"
                            style={{
                              left: `${selectedOcrAdjustment.cropRect.x}%`,
                              top: `${selectedOcrAdjustment.cropRect.y}%`,
                              width: `${selectedOcrAdjustment.cropRect.width}%`,
                              height: `${selectedOcrAdjustment.cropRect.height}%`,
                            }}
                          />
                        )}
                      </div>
                    )}
                  </div>

                  {ocrResultMeta && (
                    <div className="expense-ocr-result-summary">
                      <div className="expense-ocr-confidence-header">
                        <div className="expense-ocr-confidence-score">
                          <strong>OCR Confidence: {ocrResultMeta.overallConfidence}%</strong>
                          <div className={`expense-ocr-confidence-indicator ${
                            ocrResultMeta.overallConfidence >= 80 ? 'high' :
                            ocrResultMeta.overallConfidence >= 60 ? 'medium' : 'low'
                          }`}>
                            {ocrResultMeta.overallConfidence >= 80 ? 'High' :
                             ocrResultMeta.overallConfidence >= 60 ? 'Medium' : 'Low'}
                          </div>
                        </div>
                        {ocrResultMeta.overallConfidence < 70 && (
                          <div className="expense-ocr-confidence-warning">
                            ⚠️ Low confidence detected. Please review and verify the extracted data carefully.
                          </div>
                        )}
                      </div>
                      {ocrResultMeta.predictedCategory && (
                        <div className="expense-ocr-category-info">
                          <span>AI Suggested Category: <strong>{ocrResultMeta.predictedCategory}</strong></span>
                        </div>
                      )}
                      {(ocrResultMeta.warnings?.length > 0 || ocrResultMeta.validation?.length > 0) && (
                        <div className="expense-ocr-warnings">
                          <div className="expense-ocr-warnings-title">⚠️ Issues to Review:</div>
                          <ul className="expense-ocr-warnings-list">
                            {[...(ocrResultMeta.warnings || []), ...(ocrResultMeta.validation || [])].map((warning, index) => (
                              <li key={index}>{warning}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  <FormErrorSlot message={ocrFormError} className="form-error-slot-global" />
                  <div className="expense-modal-footer expense-ocr-footer">
                    <button className="expense-cancel-btn" onClick={closeOcrModal}>
                      Cancel
                    </button>
                    {selectedOcrAdjustment.cropRect && !selectedOcrReceipt?.isPdf && (
                      <button
                        type="button"
                        className="expense-submit-btn expense-ocr-clear-btn"
                        onClick={() => updateOcrAdjustment(selectedOcrReceipt.id, "cropRect", null)}
                      >
                        Clear Crop
                      </button>
                    )}
                    <button
                      className="expense-ai-btn"
                      onClick={handleRunExpenseOcr}
                      disabled={ocrProcessing || !selectedOcrReceipt}
                    >
                      {ocrProcessing ? "AI OCR Processing..." : "AI OCR Processing"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {showLogModal &&
        ReactDOM.createPortal(
          <div className="expense-modal-overlay">
            <div className="expense-modal expense-log-modal">
              <div className="expense-modal-header">
                <h3>{editingExpense ? "Edit Expense" : "Log Expense"}</h3>
                <span
                  className="expense-close-btn"
                  onClick={() => {
                    setShowLogModal(false);
                    resetForm();
                    setLogFormError("");
                  }}
                >
                  x
                </span>
              </div>

              <div className="expense-log-content">
                <div className="expense-log-form-panel">
                  <div className="expense-form-grid">
                    <div className="expense-form-group">
                      <label>Category</label>
                      <select name="category" value={formData.category} onChange={handleChange}>
                        {dynamicCategories.map((c) => (
                          <option key={`${c.value}-${c.label}`} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {formData.category === "other" && (
                      <div className="expense-form-group">
                        <label>Other Expense Category</label>
                        <input
                          type="text"
                          name="otherCategory"
                          value={formData.otherCategory}
                          onChange={handleChange}
                          placeholder="Enter custom expense category"
                        />
                      </div>
                    )}

                    <div className="expense-form-group">
                      <label>Vendor Name</label>
                      <input
                        type="text"
                        name="vendorName"
                        value={formData.vendorName}
                        onChange={handleChange}
                        placeholder="Vendor name"
                      />
                    </div>

                    <div className="expense-form-group">
                      <label>Date</label>
                      <input type="date" name="date" value={formData.date} onChange={handleChange} />
                    </div>

                    <div className="expense-form-group">
                      <label>Type Of Expense</label>
                      <select
                        name="referenceType"
                        value={formData.referenceType}
                        onChange={handleChange}
                      >
                        <option value="Lead">Lead Time</option>
                        <option value="Deal">Deal Time</option>
                      </select>
                    </div>

                    <div className="expense-form-group">
                      <label>Total Expense(Including Tax)</label>
                      <input type="number" name="total" value={formData.total} onChange={handleChange} />
                    </div>

                    <div className="expense-form-group expense-full-width">
                      <label>Receipt</label>
                      <button
                        type="button"
                        className="expense-upload-receipt-btn"
                        onClick={() => document.getElementById("expenseReceiptInput")?.click()}
                      >
                        Upload Receipt(s)
                      </button>
                      <input
                        id="expenseReceiptInput"
                        type="file"
                        accept="image/*,application/pdf"
                        multiple
                        style={{ display: "none" }}
                        onChange={handleReceiptSelect}
                      />
                      <small>
                        {receiptFiles.length > 0
                          ? `${receiptFiles.length} file(s) selected`
                          : "No file selected (Images/PDF only)"}
                      </small>
                      {receiptFiles.length > 0 && (
                        <div className="expense-selected-receipts">
                          {receiptFiles.map((file, index) => (
                            <div
                              className="expense-selected-receipt-item"
                              key={`${file.name}-${file.lastModified}-${index}`}
                            >
                              <span title={file.name}>{file.name}</span>
                              <button
                                type="button"
                                className="expense-remove-receipt-btn"
                                onClick={() => handleRemoveReceipt(index)}
                                aria-label={`Remove ${file.name}`}
                              >
                                x
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="expense-form-group expense-full-width">
                      <label>Description</label>
                      <textarea name="description" value={formData.description} onChange={handleChange} />
                    </div>
                  </div>
                </div>

                <aside className="expense-log-receipt-panel">
                  <div className="expense-receipt-preview-header">
                    <span>Receipt Preview</span>
                    {formReceiptPreviewName && <strong title={formReceiptPreviewName}>{formReceiptPreviewName}</strong>}
                  </div>

                  <div className="expense-receipt-preview-box">
                    {!formReceiptPreviewSource ? (
                      <div className="expense-receipt-preview-empty">
                        Upload or run OCR on a receipt to verify the autofilled data here.
                      </div>
                    ) : formReceiptPreviewIsPdf ? (
                      <iframe
                        title="Receipt verification preview"
                        src={formReceiptPreviewSource}
                        className="expense-receipt-preview-frame"
                      />
                    ) : (
                      <img
                        src={formReceiptPreviewSource}
                        alt="Receipt verification preview"
                        className="expense-receipt-preview-image"
                      />
                    )}
                  </div>
                </aside>
              </div>

              <FormErrorSlot message={logFormError} className="form-error-slot-global" />
              <div className="expense-modal-footer">
                <button
                  className="expense-cancel-btn"
                  onClick={() => {
                    setShowLogModal(false);
                    resetForm();
                    setLogFormError("");
                  }}
                >
                  Cancel
                </button>
                <button className="expense-submit-btn" onClick={handleSubmitExpense}>
                  {editingExpense ? "Update Expense" : "Log Expense"}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {showViewModal &&
        viewingExpense &&
        ReactDOM.createPortal(
          <div className="expense-modal-overlay">
            <div className="expense-modal expense-view-modal">
              <div className="expense-modal-header">
                <h3>Expense Details</h3>
                <span
                  className="expense-close-btn"
                  onClick={() => {
                    setShowViewModal(false);
                    setViewingExpense(null);
                  }}
                >
                  x
                </span>
              </div>

              <div className="expense-view-grid">
                <div className="expense-view-item">
                  <span>Category</span>
                  <strong>{viewingExpense.categoryLabel}</strong>
                </div>
                <div className="expense-view-item">
                  <span>User</span>
                  <strong>{viewingExpense.user}</strong>
                </div>
                <div className="expense-view-item">
                  <span>Vendor</span>
                  <strong>{viewingExpense.vendorName || "-"}</strong>
                </div>
                <div className="expense-view-item">
                  <span>Amount</span>
                  <strong>Rs. {viewingExpense.amount.toFixed(2)}</strong>
                </div>
                <div className="expense-view-item">
                  <span>Total</span>
                  <strong>Rs. {viewingExpense.total.toFixed(2)}</strong>
                </div>
                <div className="expense-view-item">
                  <span>Date</span>
                  <strong>{viewingExpense.date || "-"}</strong>
                </div>
                <div className="expense-view-item">
                  <span>Status</span>
                  <strong
                    className={
                      viewingExpense.status === "approved"
                        ? "expense-approved"
                        : viewingExpense.status === "rejected"
                          ? "expense-rejected"
                          : "expense-pending"
                    }
                  >
                    {viewingExpense.status}
                  </strong>
                </div>
                {viewingExpense.status === "rejected" && (
                  <div className="expense-view-item expense-view-full">
                    <span>Rejected Reason</span>
                    <strong>{viewingExpense.approvalRemarks || "-"}</strong>
                  </div>
                )}
                <div className="expense-view-item">
                  <span>Reference Type</span>
                  <strong>{viewingExpense.referenceType || "-"}</strong>
                </div>
                <div className="expense-view-item">
                  <span>Receipt</span>
                  {Array.isArray(viewingExpense.receipts) && viewingExpense.receipts.length > 0 ? (
                    <div className="expense-receipt-list">
                      {viewingExpense.receipts.map((item, index) => (
                        <div className="expense-receipt-item" key={`${item.fileUrl}-${index}`}>
                          <a href={getReceiptUrl(item.fileUrl)} target="_blank" rel="noreferrer">
                            View Document {index + 1}
                          </a>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <strong>Not uploaded</strong>
                  )}
                </div>
                <div className="expense-view-item expense-view-full">
                  <span>Description</span>
                  <strong>{viewingExpense.description || "-"}</strong>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {showRejectModal &&
        rejectingExpense &&
        ReactDOM.createPortal(
          <div className="expense-modal-overlay">
            <div className="expense-modal expense-reject-modal">
              <div className="expense-modal-header">
                <h3>Reject Expense</h3>
                <span className="expense-close-btn" onClick={closeRejectModal}>
                  x
                </span>
              </div>

              <div className="expense-reject-meta">
                <p>
                  You are rejecting expense submitted by{" "}
                  <strong>{rejectingExpense.user}</strong>.
                </p>
              </div>

              <div className="expense-form-group expense-full-width">
                <label>Reason for rejection</label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Write a clear reason so the employee can correct and resubmit."
                />
              </div>

              <FormErrorSlot message={rejectFormError} className="form-error-slot-global" />
              <div className="expense-modal-footer">
                <button className="expense-cancel-btn" onClick={closeRejectModal}>
                  Cancel
                </button>
                <button className="expense-submit-btn" onClick={submitRejectReason}>
                  Confirm Reject
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {showReasonModal &&
        reasonExpense &&
        ReactDOM.createPortal(
          <div className="expense-modal-overlay">
            <div className="expense-modal expense-reason-modal">
              <div className="expense-modal-header">
                <h3>Rejected Reason</h3>
                <span className="expense-close-btn" onClick={closeReasonModal}>
                  x
                </span>
              </div>

              <div className="expense-reason-body">
                <p>{reasonExpense.approvalRemarks || "No reason provided."}</p>
              </div>

              <div className="expense-modal-footer">
                <button className="expense-submit-btn" onClick={closeReasonModal}>
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default ExpenseDashboard;







