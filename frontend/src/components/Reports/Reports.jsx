import React, { useEffect, useState } from "react";
import API from "../../api";
import ReportsHeader from "./ReportsHeader";
import CustomTab from "./tabs/CustomTab";
import SalesTab from "./tabs/SalesTab";
import LeadsTab from "./tabs/LeadsTab";
import ExpenseTab from "./tabs/ExpenseTab";
import "./styles/Reports.css";

const REPORT_TYPES = [
  { key: "custom", label: "Custom" },
  { key: "sales", label: "Sales Report" },
  { key: "leads", label: "Leads Report" },
  { key: "expense", label: "Expense Report" },
  // { key: "team", label: "Team Report" },
];

function createDefaultSalesFilters() {
  const now = new Date();
  const month = String(now.getMonth() + 1);
  const year = String(now.getFullYear());

  return {
    period: "monthly",
    month,
    quarter: now.getMonth() < 3 ? "q1" : now.getMonth() < 6 ? "q2" : now.getMonth() < 9 ? "q3" : "q4",
    year,
    assignedTo: "all",
  };
}

function createDefaultPeriodFilters() {
  const now = new Date();
  return {
    period: "monthly",
    month: String(now.getMonth() + 1),
    quarter: now.getMonth() < 3 ? "q1" : now.getMonth() < 6 ? "q2" : now.getMonth() < 9 ? "q3" : "q4",
    year: String(now.getFullYear()),
  };
}

function normalizeRoleName(value) {
  return String(value || "").trim().toLowerCase();
}

function Reports() {
  const [activeType, setActiveType] = useState("custom");
  const [salesFilters, setSalesFilters] = useState(createDefaultSalesFilters);
  const [leadsFilters, setLeadsFilters] = useState(createDefaultPeriodFilters);
  const [expenseFilters, setExpenseFilters] = useState(createDefaultPeriodFilters);
  const [salesUsers, setSalesUsers] = useState([]);
  const [canUseAllSalesUsers, setCanUseAllSalesUsers] = useState(true);
  const [salesAllOptionLabel, setSalesAllOptionLabel] = useState("All Users");

  const selectedSalesUser =
    salesFilters.assignedTo && salesFilters.assignedTo !== "all"
      ? salesUsers.find((user) => String(user?._id || "") === String(salesFilters.assignedTo)) || null
      : null;

  useEffect(() => {
    let isMounted = true;

    async function loadSalesScope() {
      try {
        const meRes = await API.get("/users/me");
        if (!isMounted) return;

        const me = meRes.data || null;
        const roleName = normalizeRoleName(me?.role?.name || localStorage.getItem("RoleName") || "");
        const selfUser = me
          ? {
              _id: me._id,
              name: me.name || me.email || "Me",
              email: me.email || "",
              roleName: me?.role?.name || "",
            }
          : null;

        if (roleName === "admin") {
          const usersRes = await API.get("/users");
          if (!isMounted) return;
          const nextUsers = Array.isArray(usersRes.data)
            ? usersRes.data.filter((user) => normalizeRoleName(user?.roleName) !== "admin")
            : [];
          setSalesUsers(nextUsers);
          setCanUseAllSalesUsers(true);
          setSalesAllOptionLabel("All Users");
          return;
        }

        if (roleName === "manager") {
          const teamsRes = await API.get("/teams/me");
          if (!isMounted) return;
          const teams = Array.isArray(teamsRes.data) ? teamsRes.data : [];
          const memberMap = new Map();

          if (selfUser?._id) {
            memberMap.set(String(selfUser._id), selfUser);
          }

          teams.forEach((team) => {
            (team?.members || []).forEach((member) => {
              const user = member?.userId;
              const userId = String(user?._id || "").trim();
              if (!userId) return;
              memberMap.set(userId, {
                _id: userId,
                name: user?.name || user?.email || "User",
                email: user?.email || "",
                roleName: user?.roleName || "",
              });
            });
          });

          setSalesUsers([...memberMap.values()]);
          setCanUseAllSalesUsers(true);
          setSalesAllOptionLabel("My Team + Me");
          return;
        }

        setSalesUsers(selfUser ? [selfUser] : []);
        setCanUseAllSalesUsers(false);
        setSalesAllOptionLabel("My Reports");
        setSalesFilters((current) => ({
          ...current,
          assignedTo: selfUser?._id || current.assignedTo,
        }));
      } catch {
        if (!isMounted) return;
        setSalesUsers([]);
      }
    }

    loadSalesScope();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!salesUsers.length) return;

    setSalesFilters((current) => {
      if (canUseAllSalesUsers && current.assignedTo === "all") {
        return current;
      }

      const isValidSelection = salesUsers.some(
        (user) => String(user?._id || "") === String(current.assignedTo)
      );

      if (isValidSelection) {
        return current;
      }

      return {
        ...current,
        assignedTo: canUseAllSalesUsers ? "all" : String(salesUsers[0]?._id || current.assignedTo),
      };
    });
  }, [canUseAllSalesUsers, salesUsers]);

  const renderContent = () => {
    switch (activeType) {
      case "custom":
        return <CustomTab />;
      case "sales":
        return <SalesTab filters={salesFilters} selectedUser={selectedSalesUser} />;
      case "leads":
        return <LeadsTab filters={leadsFilters} />;
      case "expense":
        return <ExpenseTab filters={expenseFilters} />;
      default:
        return null;
    }
  };

  return (
    <div className="reports-page">
      <ReportsHeader
        activeType={activeType}
        setActiveType={setActiveType}
        salesFilters={salesFilters}
        setSalesFilters={setSalesFilters}
        salesUsers={salesUsers}
        canUseAllSalesUsers={canUseAllSalesUsers}
        salesAllOptionLabel={salesAllOptionLabel}
        leadsFilters={leadsFilters}
        setLeadsFilters={setLeadsFilters}
        expenseFilters={expenseFilters}
        setExpenseFilters={setExpenseFilters}
        reportTypes={REPORT_TYPES}
      />
      {renderContent()}
    </div>
  );
}

export default Reports;
