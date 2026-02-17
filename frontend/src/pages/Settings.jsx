import React, { useEffect, useState } from "react";
import "./Settings.css";

export default function Settings({ user }) {

    const isAdmin = user.role === "admin";


    /* =======================STATE========================= */

    const [loading, setLoading] = useState(true);

    const [crmSettings, setCrmSettings] = useState(null);

    const [notifications, setNotifications] = useState(null);

    const [integrations, setIntegrations] = useState(null);

    const [roles, setRoles] = useState([]);
    const [products, setProducts] = useState([]);
    const [industries, setIndustries] = useState([]);
    const [sources, setSources] = useState([]);


    /* ====================DUMMY DATA======================== */

    const dummyCRMSettings = {

        smartFollowup: true,
        leadScoring: true,
        predictiveAnalytics: true

    };

    const dummyNotifications = {

        inApp: true,
        email: true,
        whatsapp: true,
        reminderFrequency: "30 minutes before"

    };

    const dummyIntegrations = {

        whatsapp: true,
        gmail: true,
        calendar: false

    };

    const dummyDropdowns = {

        roles: ["Admin", "Sales Manager", "Sales Person"],

        products: ["CRM Suite", "ERP System", "AI Platform"],

        industries: ["IT", "Finance", "Healthcare"],

        sources: ["Website", "Referral", "Expo"]

    };


    /* =========================LOAD SETTINGS======================= */

    useEffect(() => {

        loadSettings();

    }, []);



    async function loadSettings() {

        setLoading(true);

        try {

            setCrmSettings(dummyCRMSettings);

            setNotifications(dummyNotifications);

            setIntegrations(dummyIntegrations);

            if (isAdmin) {

                setRoles(dummyDropdowns.roles);
                setProducts(dummyDropdowns.products);
                setIndustries(dummyDropdowns.industries);
                setSources(dummyDropdowns.sources);

            }


            /*
            const crmRes = await fetch("/api/crm-settings");
            const crmData = await crmRes.json();
            setCrmSettings(crmData);


            const notifRes = await fetch("/api/notification-settings");
            const notifData = await notifRes.json();
            setNotifications(notifData);


            const intRes = await fetch("/api/integrations");
            const intData = await intRes.json();
            setIntegrations(intData);


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

            console.error(err);

        }
        finally {

            setLoading(false);

        }

    }



    /* =========================CRM TOGGLE======================== */

    function toggleCRM(key) {

        const updated = {

            ...crmSettings,
            [key]: !crmSettings[key]

        };

        setCrmSettings(updated);

        /*
        fetch("/api/crm-settings", {
            method: "PUT",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify(updated)
        });
        */

    }



    /* ====================NOTIFICATION TOGGLE======================= */

    function toggleNotification(key) {

        const updated = {

            ...notifications,
            [key]: !notifications[key]

        };

        setNotifications(updated);

        /*
        fetch("/api/notification-settings", {
            method: "PUT",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify(updated)
        });
        */

    }



    function changeReminderFrequency(value) {

        const updated = {

            ...notifications,
            reminderFrequency: value

        };

        setNotifications(updated);

    }



    /* ======================INTEGRATION CONNECT========================== */

    function toggleIntegration(key) {

        const updated = {

            ...integrations,
            [key]: !integrations[key]

        };

        setIntegrations(updated);

        /*
        fetch(`/api/integrations/${key}`, {
            method: "POST"
        });
        */

    }



    /* =======================ADMIN CRUD========================== */

    function addItem(type, value) {

        if (!value.trim()) return;

        const map = {

            roles: setRoles,
            products: setProducts,
            industries: setIndustries,
            sources: setSources

        };

        map[type](prev => [...prev, value]);

    }


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

    }



    /* ========================LOADING========================== */

    if (loading || !crmSettings || !notifications || !integrations)
        return <div className="settings-page">Loading...</div>;



    /* ==================UI==================== */

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
                    onChange={()=>toggleCRM("smartFollowup")}
                />

                <Toggle
                    title="AI Lead Scoring"
                    value={crmSettings.leadScoring}
                    onChange={()=>toggleCRM("leadScoring")}
                />

                <Toggle
                    title="Predictive Analytics"
                    value={crmSettings.predictiveAnalytics}
                    onChange={()=>toggleCRM("predictiveAnalytics")}
                />

            </div>



            {/* NOTIFICATIONS */}

            <div className="settings-card">

                <h3>Notifications</h3>

                <div className="admin-section">

                    <h4>Follow-up Reminder Method</h4>

                    <Checkbox
                        label="In-App"
                        checked={notifications.inApp}
                        onChange={()=>toggleNotification("inApp")}
                    />

                    <Checkbox
                        label="Email"
                        checked={notifications.email}
                        onChange={()=>toggleNotification("email")}
                    />

                    <Checkbox
                        label="WhatsApp"
                        checked={notifications.whatsapp}
                        onChange={()=>toggleNotification("whatsapp")}
                    />

                </div>


                <div className="admin-section">

                    <h4>Reminder Frequency</h4>

                    <select
                        value={notifications.reminderFrequency}
                        onChange={(e)=>
                            changeReminderFrequency(e.target.value)
                        }
                    >

                        <option>5 minutes before</option>
                        <option>15 minutes before</option>
                        <option>30 minutes before</option>
                        <option>1 hour before</option>
                        <option>1 day before</option>

                    </select>

                </div>

            </div>



            {/* INTEGRATIONS */}

            <div className="settings-card">

                <h3>Integrations</h3>

                <IntegrationRow
                    title="WhatsApp Business"
                    subtitle="Send messages directly from CRM"
                    connected={integrations.whatsapp}
                    onClick={()=>toggleIntegration("whatsapp")}
                />

                <IntegrationRow
                    title="Gmail"
                    subtitle="Sync emails and track opens"
                    connected={integrations.gmail}
                    onClick={()=>toggleIntegration("gmail")}
                />

                <IntegrationRow
                    title="Google Calendar"
                    subtitle="Sync meetings and reminders"
                    connected={integrations.calendar}
                    onClick={()=>toggleIntegration("calendar")}
                />

            </div>



            {/* ADMIN SECTION */}

            {isAdmin && (

                <div className="settings-card">

                    <h3>Admin Configuration</h3>

                    <AdminSection title="Roles" items={roles} onAdd={(v)=>addItem("roles",v)} onDelete={(v)=>deleteItem("roles",v)} />

                    <AdminSection title="Products" items={products} onAdd={(v)=>addItem("products",v)} onDelete={(v)=>deleteItem("products",v)} />

                    <AdminSection title="Industries" items={industries} onAdd={(v)=>addItem("industries",v)} onDelete={(v)=>deleteItem("industries",v)} />

                    <AdminSection title="Sources" items={sources} onAdd={(v)=>addItem("sources",v)} onDelete={(v)=>deleteItem("sources",v)} />

                </div>

            )}

        </div>

    );

}



/* =====================================================
   SUB COMPONENTS
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


function Checkbox({ label, checked, onChange }) {

    return (

        <label style={{display:"block",marginBottom:"6px"}}>

            <input
                type="checkbox"
                checked={checked}
                onChange={onChange}
                style={{marginRight:"6px"}}
            />

            {label}

        </label>

    );

}


function IntegrationRow({ title, subtitle, connected, onClick }) {

    return (

        <div className="integration-row">

            <div>

                <div className="integration-title">
                    {title}
                </div>

                <div className="integration-subtitle">
                    {subtitle}
                </div>

            </div>

            <button
                className={
                    connected
                    ? "btn-connected"
                    : "btn-connect"
                }
                onClick={onClick}
            >

                {connected ? "Connected" : "Connect"}

            </button>

        </div>

    );

}


function AdminSection({ title, items, onAdd, onDelete }) {

    const [input, setInput] = useState("");

    return (

        <div className="admin-section settings-card1">

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

                        <button onClick={()=>onDelete(item)}>
                            Delete
                        </button>

                    </li>

                ))}

            </ul>

        </div>

    );

}
