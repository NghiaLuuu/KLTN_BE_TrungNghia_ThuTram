# 🔒 Role-Based Data Filtering Implementation

## 📋 Overview

Implement role-based access control for appointments and records:
- **Admin, Manager, Receptionist**: See ALL data
- **Dentist**: Only see appointments/records assigned to them
- **Nurse**: Only see appointments assigned to them (and related records)

---

## 🎯 Requirements

### User Story:
> "Ở role nurse và dentist, chưa hiển thị được dashboard appointments và records.
> Với admin, manager thì hiển thị hết.
> Còn với dentist và nurse thì chỉ hiển thị phiếu khám và hồ sơ liên quan đến nurse và dentist đó thôi."

### Data Model:
- **Appointment**: Has `dentistId` and `nurseId`
- **Record**: Has `dentistId` only (no `nurseId`)
- **Solution**: Filter records by appointmentId for nurses

---

## ✅ Changes Implemented

### 1. Appointment Service

#### Controller (`appointment.controller.js`)
```javascript
async getAllAppointments(req, res) {
  const filters = { /* ...query params */ };

  // 🔒 Role-based filtering
  const userRole = req.user?.role;
  const userId = req.user?.userId || req.user?._id;

  if (userRole === 'dentist') {
    filters.dentistId = userId;
  } else if (userRole === 'nurse') {
    filters.nurseId = userId;
  }
  // Admin, manager, receptionist see all
}
```

#### Service (`appointment.service.js`)
```javascript
async getAllAppointments(filters = {}) {
  const { dentistId, nurseId, /* ...other filters */ } = filters;

  const query = {};
  
  if (dentistId) query.dentistId = dentistId;
  if (nurseId) query.nurseId = nurseId;  // ✅ Added
  
  // ...rest of query building
}
```

---

### 2. Record Service

#### Controller (`record.controller.js`)
```javascript
async getAll(req, res) {
  const filters = { /* ...query params */ };

  // 🔒 Role-based filtering
  const userRole = req.user?.role;
  const userId = req.user?.userId || req.user?._id;

  if (userRole === 'dentist') {
    filters.dentistId = userId;
  } else if (userRole === 'nurse') {
    filters.nurseId = userId;  // Will be handled in repository
  }
  // Admin, manager see all
}
```

#### Repository (`record.repository.js`)
```javascript
async findAll(filters = {}) {
  const query = {};

  // ... other filters

  // 🔒 Nurse filter: Cross-service lookup
  if (filters.nurseId) {
    try {
      // Call appointment service to get appointments for this nurse
      const response = await axios.get(APPOINTMENT_SERVICE_URL, {
        params: { nurseId: filters.nurseId }
      });

      const appointmentIds = response.data.data.appointments.map(apt => apt._id);
      
      if (appointmentIds.length > 0) {
        query.appointmentId = { $in: appointmentIds };
      } else {
        return []; // No appointments = no records
      }
    } catch (error) {
      console.error('Failed to fetch nurse appointments');
      return [];
    }
  }

  return await Record.find(query).sort({ createdAt: -1 });
}
```

---

### 3. Frontend Auto-Refresh

#### PatientRecords.jsx
```javascript
// Auto refresh every 30 seconds
useEffect(() => {
  if (!user?._id) return;

  const intervalId = setInterval(() => {
    loadRecords();
  }, 30000);

  return () => clearInterval(intervalId);
}, [user?._id]);
```

#### RecordList.jsx
```javascript
// Auto refresh only when no filters applied
useEffect(() => {
  const hasFilters = searchKeyword || filterType || filterStatus || filterDentist || dateRange;
  if (hasFilters) return;

  const intervalId = setInterval(() => {
    loadRecords();
  }, 30000);

  return () => clearInterval(intervalId);
}, [searchKeyword, filterType, filterStatus, filterDentist, dateRange]);
```

---

## 🔐 Security Matrix

| Role | Appointments | Records |
|------|-------------|---------|
| **Admin** | All | All |
| **Manager** | All | All |
| **Receptionist** | All | All |
| **Dentist** | Where `dentistId = currentUser._id` | Where `dentistId = currentUser._id` |
| **Nurse** | Where `nurseId = currentUser._id` | Where `appointmentId` in nurse's appointments |

---

## 🧪 Test Cases

### Test 1: Admin Login
- ✅ See all appointments
- ✅ See all records

### Test 2: Dentist Login (Dr. A)
- ✅ See only appointments assigned to Dr. A
- ✅ See only records created by Dr. A
- ❌ Cannot see Dr. B's appointments/records

### Test 3: Nurse Login (Nurse X)
- ✅ See only appointments where Nurse X is assigned
- ✅ See only records linked to those appointments
- ❌ Cannot see appointments without Nurse X

### Test 4: Auto-Refresh
- ✅ New appointments/records appear within 30 seconds
- ✅ Refresh pauses when filters are active (RecordList only)

---

## 📝 Technical Notes

### Why Cross-Service Call for Nurses?

**Problem**: `Record` model doesn't have `nurseId` field.

**Solution**: 
1. Nurse filter in record-service calls appointment-service
2. Get list of appointmentIds where nurse is assigned
3. Filter records by those appointmentIds

**Alternative Considered**: Add `nurseId` to Record model
- ❌ Rejected: Would require data migration
- ❌ Rejected: Nurse assignment is appointment-specific, not record-specific
- ✅ Current approach: Keep data normalized, use service communication

### Environment Variables

Record service needs to know appointment service URL:
```bash
APPOINTMENT_SERVICE_URL=http://localhost:3008
```

---

## 🚀 Deployment Checklist

- [x] Update appointment controller
- [x] Update appointment service
- [x] Update record controller
- [x] Update record repository
- [x] Add APPOINTMENT_SERVICE_URL to record-service env
- [x] Add frontend auto-refresh
- [ ] Restart appointment-service
- [ ] Restart record-service
- [ ] Test with dentist account
- [ ] Test with nurse account
- [ ] Test with admin account

---

**Implemented by:** GitHub Copilot  
**Date:** 2025-10-30  
**Issue:** Dentist/Nurse role-based filtering
