import React, { useEffect, useState } from "react";
import "./Settings.css";

/*
=========================================================
SETTINGS COMPONENT

Supports:
- admin
- sales-manager
- sales-person

Backend switch:
COMMENT dummy lines
UNCOMMENT real API lines

=========================================================
*/

export default function Settings({ user }) {

    const isAdmin = user.role === "admin";


    /* =====================================================
       STATE
    ===================================================== */

    const [crmSettings, setCrmSettings] = useState(null);

    const [roles, setRoles] = useState([]);
    const [products, setProducts] = useState([]);
    const [industries, setIndustries] = useState([]);
    const [sources, setSources] = useState([]);

    const [loading, setLoading] = useState(true);


    /* =====================================================
       DUMMY DATA (FOR TESTING)
       COMMENT THIS BLOCK WHEN USING REAL BACKEND
    ===================================================== */

    const dummyCRMSettings = {

        smartFollowup: true,
        leadScoring: true,
        predictiveAnalytics: false,

        reminderMethods: {
            inApp: true,
            email: true,
            whatsapp: true
        },

        reminderFrequency: "30 minutes before"

    };


    const dummyDropdownData = {

        roles: ["Admin", "Sales Manager", "Sales Person"],

        products: [
            "CRM Suite",
            "ERP System",
            "AI Automation"
        ],

        industries: [
            "Information Technology",
            "Finance",
            "Healthcare"
        ],

        sources: [
            "Website",
            "Referral",
            "Exhibition",
            "Cold Call"
        ]

    };


    /* =====================================================
       LOAD SETTINGS
    ===================================================== */

    useEffect(() => {

        loadSettings();

    }, []);



    async function loadSettings() {

        setLoading(true);

        try {

            /* ==========================================
               USE DUMMY DATA (CURRENTLY ACTIVE)
               COMMENT THIS WHEN USING REAL BACKEND
            ========================================== */

            setCrmSettings(dummyCRMSettings);

            if (isAdmin) {

                setRoles(dummyDropdownData.roles);
                setProducts(dummyDropdownData.products);
                setIndustries(dummyDropdownData.industries);
                setSources(dummyDropdownData.sources);

            }



            /* ==========================================
               REAL BACKEND (UNCOMMENT WHEN READY)
            ========================================== */

            /*
            const crmRes = await fetch("/api/crm-settings");
            const crmData = await crmRes.json();

            setCrmSettings(crmData);


            if (isAdmin) {

                const dropRes = await fetch("/api/admin/dropdowns");
                const dropData = await dropRes.json();

                setRoles(dropData.roles);
                setProducts(dropData.products);
                setIndustries(dropData.industries);
                setSources(dropData.sources);

            }
            */


        }
        catch (err) {

            console.error("Settings load error:", err);

        }
        finally {

            setLoading(false);

        }

    }



    /* =====================================================
       UPDATE CRM SETTING
    ===================================================== */

    function toggleCRMSetting(key) {

        const updated = {

            ...crmSettings,
            [key]: !crmSettings[key]

        };

        setCrmSettings(updated);


        /* ==========================================
           REAL BACKEND UPDATE
           UNCOMMENT WHEN READY
        ========================================== */

        /*
        fetch("/api/crm-settings", {

            method: "PUT",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify(updated)

        });
        */

    }



    /* =====================================================
       ADMIN ADD ITEM
    ===================================================== */

    function addItem(type, value) {

        if (!value.trim()) return;

        const map = {

            roles: setRoles,
            products: setProducts,
            industries: setIndustries,
            sources: setSources

        };

        map[type](prev => [...prev, value]);


        /*
        fetch(`/api/admin/${type}`, {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({ name: value })

        });
        */

    }



    /* =====================================================
       ADMIN DELETE ITEM
    ===================================================== */

    function deleteItem(type, value) {

        const map = {

            roles: setRoles,
            products: setProducts,
            industries: setIndustries,
            sources: setSources

        };

        map[type](prev =>
            prev.filter(item => item !== value)
        );


        /*
        fetch(`/api/admin/${type}/${value}`, {

            method: "DELETE"

        });
        */

    }



    /* =====================================================
       LOADING STATE
    ===================================================== */

    if (loading || !crmSettings)
        return <div className="settings-page">Loading...</div>;



    /* =====================================================
       UI
    ===================================================== */

    return (

        <div className="settings-page">

            {/* HEADER */}

            <div className="settings-header">

                <h2>Settings</h2>

                <div>

                    {user.name}

                    <span className="role-badge">
                        {user.role}
                    </span>

                </div>

            </div>



            {/* CRM SETTINGS */}

            <div className="settings-card">

                <h3>CRM Settings</h3>

                <Toggle
                    title="Smart Follow-up Reminders"
                    value={crmSettings.smartFollowup}
                    onChange={() =>
                        toggleCRMSetting("smartFollowup")
                    }
                />

                <Toggle
                    title="AI Lead Scoring"
                    value={crmSettings.leadScoring}
                    onChange={() =>
                        toggleCRMSetting("leadScoring")
                    }
                />

                <Toggle
                    title="Predictive Analytics"
                    value={crmSettings.predictiveAnalytics}
                    onChange={() =>
                        toggleCRMSetting("predictiveAnalytics")
                    }
                />

            </div>



            {/* ADMIN SECTION */}

            {isAdmin && (

                <div className="settings-card">

                    <h3>Admin Configuration</h3>

                    <AdminSection
                        title="Roles"
                        items={roles}
                        onAdd={(v)=>addItem("roles",v)}
                        onDelete={(v)=>deleteItem("roles",v)}
                    />

                    <AdminSection
                        title="Products"
                        items={products}
                        onAdd={(v)=>addItem("products",v)}
                        onDelete={(v)=>deleteItem("products",v)}
                    />

                    <AdminSection
                        title="Industries"
                        items={industries}
                        onAdd={(v)=>addItem("industries",v)}
                        onDelete={(v)=>deleteItem("industries",v)}
                    />

                    <AdminSection
                        title="Sources"
                        items={sources}
                        onAdd={(v)=>addItem("sources",v)}
                        onDelete={(v)=>deleteItem("sources",v)}
                    />

                </div>

            )}

        </div>

    );

}



/* =====================================================
   TOGGLE COMPONENT
===================================================== */

function Toggle({ title, value, onChange }) {

    return (

        <div className="setting-row">

            <span>{title}</span>

            <label className="switch">

                <input
                    type="checkbox"
                    checked={value}
                    onChange={onChange}
                />

                <span className="slider"></span>

            </label>

        </div>

    );

}



/* =====================================================
   ADMIN SECTION
===================================================== */

function AdminSection({
    title,
    items,
    onAdd,
    onDelete
}) {

    const [input, setInput] = useState("");

    return (

        <div className="admin-section">

            <h4>{title}</h4>

            <div className="admin-input">

                <input
                    value={input}
                    onChange={(e)=>setInput(e.target.value)}
                    placeholder={`Add ${title}`}
                />

                <button onClick={()=>{

                    onAdd(input);
                    setInput("");

                }}>
                    Add
                </button>

            </div>

            <ul>

                {items.map(item => (

                    <li key={item}>

                        {item}

                        <button
                            onClick={()=>onDelete(item)}
                        >
                            Delete
                        </button>

                    </li>

                ))}

            </ul>

        </div>

    );

}
