# Button Standardization Guide

## Overview
All buttons throughout the application have been standardized to use a consistent color scheme based on industry standards. This guide documents the standardized button classes and colors.

## Color Palette

| Action Type | Color | Hex Code | Use Case |
|-------------|-------|----------|----------|
| **Add / Create** | Green | #28a745 | Creating new records, adding items |
| **View** | Gray | #6c757d | Viewing details, navigating |
| **Edit** | Blue | #007bff | Editing records, modifying data |
| **Delete / Remove** | Red | #dc3545 | Deleting records, destructive actions |
| **Save / Confirm** | Green | #28a745 | Saving changes, confirming actions |
| **Cancel / Back** | Light Gray | #adb5bd | Canceling operations, going back |
| **Navigation / Filtering** | Teal | #17a2b8 | Filtering, navigation between views |
| **Toggle / Switch** | Gray/Blue | #6c757d / #007bff | Toggle states, switching modes |
| **OCR / AI** | Purple | #6f42c1 | AI features, OCR processing |
| **Register / Attend** | Orange | #fd7e14 | Event registration, attendance |

## Available Button Classes

### Primary Action Buttons
```css
.btn-add        /* Add or Create (Green) */
.btn-create     /* Create buttons (Green) */
.btn-new        /* New items (Green) */
.btn-view       /* View details (Gray) */
.btn-edit       /* Edit records (Blue) */
.btn-delete     /* Delete records (Red) */
.btn-remove     /* Remove items (Red) */
.btn-save       /* Save changes (Green) */
.btn-confirm    /* Confirm actions (Green) */
.btn-cancel     /* Cancel operations (Light Gray) */
.btn-back       /* Go back (Light Gray) */
.btn-filter     /* Filter data (Teal) */
.btn-nav        /* Navigate (Teal) */
.btn-toggle     /* Toggle states (Gray) */
.btn-switch     /* Switch modes (Gray) */
.btn-ai         /* AI features (Purple) */
.btn-ocr        /* OCR processing (Purple) */
.btn-register   /* Register event (Orange) */
.btn-attend     /* Attend event (Orange) */
```

### Size Variants
```css
.btn-sm         /* Small button (6px 12px) */
.btn-lg         /* Large button (12px 24px) */
/* Default: 8px 16px */
```

### Style Variants
```css
.btn-ghost      /* Transparent with border */
.btn-outline-primary       /* Blue outline */
.btn-outline-success       /* Green outline */
.btn-outline-danger        /* Red outline */
.btn-link       /* Link-style button */
```

## Usage Examples

### React Components
```jsx
// Add button
<button className="btn-add" onClick={handleAdd}>+ Add Item</button>

// View button
<button className="btn-view" onClick={handleView}>View</button>

// Delete button with confirmation
<button className="btn-delete" onClick={handleDelete}>Delete</button>

// Save button (disabled state)
<button className="btn-save" onClick={handleSave} disabled={isLoading}>
  {isLoading ? 'Saving...' : 'Save'}
</button>

// Cancel button
<button className="btn-cancel" onClick={handleCancel}>Cancel</button>

// Size variants
<button className="btn-add btn-sm">Small Add</button>
<button className="btn-view btn-lg">Large View</button>

// Ghost style
<button className="btn-cancel btn-ghost">Cancel</button>
```

## Hover & Interaction Effects

All buttons include:
- **Color Transition**: Darker shade on hover
- **Transform**: Slight upward movement (-2px)
- **Shadow**: Contextual box-shadow based on button color

Example hover behavior:
```css
/* Green button hover (#28a745 → #218838) */
.btn-save:hover {
  background-color: #218838;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(40, 167, 69, 0.3);
}
```

## Disabled State

Disabled buttons automatically show:
- `opacity: 0.6`
- `cursor: not-allowed`

```jsx
<button className="btn-save" disabled>Save</button>
```

## Files Updated

The following CSS files have been standardized:
- `frontend/src/styles/buttons.css` (NEW - centralized button definitions)
- `frontend/src/pages/modules/styles/Clients.css`
- `frontend/src/pages/modules/styles/Deals.css`
- `frontend/src/pages/modules/styles/Quotations.css`
- `frontend/src/pages/modules/styles/Expense.css`
- `frontend/src/pages/modules/LeadsDashboard.css`
- `frontend/src/pages/modules/adminsetting/admin-config.css`
- `frontend/src/styles/AdminHome.css`
- `frontend/src/App.css` (imports buttons.css)

## Migration Notes

### Old → New Button Styles
- `clients-btn-primary` → Use `.btn-add` or `.btn-create`
- `clients-btn-secondary` → Use `.btn-cancel`
- `clients-view-btn` → Use `.btn-view`
- `deal-footer-save` → Use `.btn-save`
- `deal-footer-cancel` → Use `.btn-cancel`
- `expense-view` → Use `.btn-view`
- `expense-delete` → Use `.btn-delete`
- `quote-submit-btn` → Use `.btn-save`
- `quote-cancel-btn` → Use `.btn-cancel`

## Future Consistency

When adding new buttons:
1. Choose the appropriate semantic class (`.btn-add`, `.btn-delete`, etc.)
2. Add size variant if needed (`.btn-sm`, `.btn-lg`)
3. Avoid inline styles for button colors
4. Use the imported buttons.css for consistent theming
5. All buttons automatically inherit transition effects and hover states

## Accessibility

- All buttons have sufficient contrast ratios (WCAG AA compliant)
- Disabled buttons are visually distinct
- Hover states provide clear feedback
- Focus states are preserved through CSS transitions

## Responsive Behavior

Buttons automatically adjust on mobile devices (max-width: 768px):
- Padding reduces slightly for touch targets
- Font size optimized for smaller screens
- Maintain minimum 44px touch target height
