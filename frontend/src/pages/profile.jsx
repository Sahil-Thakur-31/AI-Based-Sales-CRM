import React, { useEffect, useState } from "react";
import "./Profile.css";

export default function Profile(/*{ userId }*/) {

    // loading state
    const [loading, setLoading] = useState(true);

    // profile state
    const [profile, setProfile] = useState(null);

    // edit mode state
    const [editMode, setEditMode] = useState(false);


    // dummy profile data (comment when using backend)
    const dummyProfile = {
        _id: "123",
        name: "Rahul Sharma",
        email: "rahul@crm.com",
        phone: "+91 9876543210",
        role: "Sales Executive",
        photoUrl: "",
        joiningDate: "2024-01-15"
    };


    // load profile on mount
    useEffect(() => {
        loadProfile();
    }, []);


    // load profile function
    async function loadProfile() {

        setLoading(true);

        try {

            // dummy data (active now)
            setProfile(dummyProfile);

            // real backend fetch (uncomment later)
            /*
            const res = await fetch(`/api/users/${userId}`);
            const data = await res.json();
            setProfile(data);
            */

        }
        catch (err) {
            console.error(err);
        }
        finally {
            setLoading(false);
        }

    }


    // update field locally
    function updateField(field, value) {

        setProfile(prev => ({
            ...prev,
            [field]: value
        }));

    }


    // save profile
    async function saveProfile() {

        try {

            setEditMode(false);

            // backend save (uncomment later)
            /*
            await fetch(`/api/users/${profile._id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(profile)
            });
            */

            console.log("Saved:", profile);

        }
        catch (err) {
            console.error(err);
        }

    }


    // handle photo upload
    function handlePhotoUpload(e) {

        const file = e.target.files[0];
        if (!file) return;

        const url = URL.createObjectURL(file);

        updateField("photoUrl", url);

        // real upload later using FormData
    }


    // loading UI
    if (loading || !profile)
        return <div className="profile-page">Loading...</div>;


    // main UI
    return (

        <div className="profile-page">

            <div className="profile-card">

                <h2>My Profile</h2>


                {/* profile photo */}

                <div className="profile-photo-section">

                    <div className="profile-photo">

                        {profile.photoUrl
                            ?
                            <img src={profile.photoUrl} alt="profile"/>
                            :
                            <div className="photo-placeholder">
                                {profile.name[0]}
                            </div>
                        }

                    </div>


                    {editMode && (

                        <input
                            type="file"
                            onChange={handlePhotoUpload}
                        />

                    )}

                </div>


                {/* name */}

                <Field
                    label="Full Name"
                    value={profile.name}
                    editable={editMode}
                    onChange={(v)=>updateField("name",v)}
                />


                {/* email */}

                <Field
                    label="Email"
                    value={profile.email}
                    editable={false}
                />


                {/* phone */}

                <Field
                    label="Phone"
                    value={profile.phone}
                    editable={editMode}
                    onChange={(v)=>updateField("phone",v)}
                />


                {/* role */}

                <Field
                    label="Role"
                    value={profile.role}
                    editable={false}
                />


                {/* joining date */}

                <Field
                    label="Joining Date"
                    value={profile.joiningDate}
                    editable={false}
                />


                {/* action button */}

                <div className="profile-actions">

                    {editMode
                        ?
                        <button onClick={saveProfile}>
                            Save
                        </button>
                        :
                        <button onClick={()=>setEditMode(true)}>
                            Edit Profile
                        </button>
                    }

                </div>


            </div>

        </div>

    );

}


// reusable field component
function Field({ label, value, editable, onChange }) {

    return (

        <div className="profile-field">

            <label>{label}</label>

            {editable
                ?
                <input
                    value={value}
                    onChange={(e)=>onChange(e.target.value)}
                />
                :
                <div className="profile-value">
                    {value}
                </div>
            }

        </div>

    );

}
