# Incident Reporting System

## Overview
The Guardian Care app now includes a comprehensive incident reporting system that allows users to submit detailed incident reports with photos, location data, and other relevant information.

## Features

### 1. Incident Report Button
- Located on the home page as a floating action button
- Icon: Document with text
- Color: Secondary (gray)
- Position: Between panic button and heatmap toggle

### 2. Incident Report Modal
The incident report modal includes the following sections:

#### Basic Information
- **Incident Type**: Dropdown with predefined types
  - Theft
  - Assault
  - Vandalism
  - Suspicious Activity
  - Traffic Accident
  - Fire
  - Medical Emergency
  - Natural Disaster
  - Other

- **Severity Level**: Dropdown with three levels
  - Low
  - Medium
  - High

- **Description**: Text area for detailed description (minimum 10 characters, maximum 500 characters)

#### Location
- **Use Current Location**: Toggle to automatically use device GPS
- **Custom Location**: Manual input of latitude and longitude coordinates
- **Location Display**: Shows selected coordinates when set

#### Photos
- **Add Photo**: Button to capture or select photos
- **Photo Sources**: Camera or Photo Library
- **Photo Gallery**: Displays selected photos with remove option
- **Photo Management**: Users can remove individual photos

#### Privacy
- **Anonymous Report**: Toggle to submit report anonymously

### 3. Technical Implementation

#### Services
- **IncidentService**: Handles all incident-related operations
  - Firebase integration for data storage
  - Image upload to Firebase Storage
  - Location services integration
  - Form validation

#### Components
- **IncidentReportModalComponent**: Main modal component
  - Form handling with validation
  - Camera integration using Capacitor
  - Location services
  - Image management

#### Dependencies
- **@capacitor/camera**: For photo capture and selection
- **@angular/fire**: For Firebase integration
- **Firebase Storage**: For image uploads
- **Location Service**: For GPS coordinates

### 4. Data Flow

1. **User Interaction**: User clicks incident report button
2. **Modal Opens**: Incident report modal appears
3. **Form Filling**: User fills out incident details
4. **Photo Capture**: User can add photos using camera or gallery
5. **Location Setting**: User sets location (current or custom)
6. **Validation**: Form validates all required fields
7. **Submission**: Data is uploaded to Firebase
8. **Confirmation**: Success message is shown

### 5. Firebase Collections

#### Incidents Collection
```typescript
{
  id: string;
  type: string;
  description: string;
  location: {
    lat: number;
    lng: number;
    address?: string;
  };
  timestamp: Date;
  severity: 'low' | 'medium' | 'high';
  status: 'pending' | 'verified' | 'resolved';
  reporterId: string;
  reporterName: string;
  media?: string[];
  anonymous: boolean;
  category?: string;
  tags?: string[];
}
```

#### Storage Structure
```
incidents/
  {userId}/
    {timestamp}.jpg
```

### 6. Security Features

- **User Authentication**: Only authenticated users can submit reports
- **Anonymous Reports**: Users can submit reports without revealing identity
- **Data Validation**: Server-side validation of all submitted data
- **Image Security**: Images are stored securely in Firebase Storage

### 7. User Experience

- **Intuitive Interface**: Clean, modern design with clear sections
- **Form Validation**: Real-time validation with helpful error messages
- **Loading States**: Visual feedback during submission
- **Success Feedback**: Confirmation messages for successful submissions
- **Error Handling**: Graceful error handling with user-friendly messages

### 8. Future Enhancements

- **Offline Support**: Queue reports when offline
- **Rich Media**: Support for video uploads
- **Geofencing**: Automatic location-based incident categorization
- **Push Notifications**: Notify authorities of high-severity incidents
- **Analytics**: Incident trend analysis and reporting
- **Integration**: Connect with emergency services APIs

## Usage Instructions

1. Navigate to the home page
2. Click the incident report button (document icon)
3. Fill out the incident details
4. Add photos if available
5. Set the incident location
6. Choose whether to submit anonymously
7. Click "Submit Report"

## Technical Notes

- The system requires camera and location permissions
- Images are compressed to 80% quality for storage efficiency
- All data is stored securely in Firebase
- The modal is responsive and works on all device sizes 