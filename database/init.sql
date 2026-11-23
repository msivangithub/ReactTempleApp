-- ============================================================
-- Temple Seva Booking - init.sql (v4) - FRESH INSTALL
-- Creates database TempleApp, the base schema (v1-v3), then runs the v4 block below, which is
-- identical to migration-v4-upgrade.sql: locations at login, per-user location access, separate
-- items per booking type, app settings and the full seed. Safe to re-run.
-- Existing database (made with the original init.sql or an earlier version)? Run
-- migration-v4-upgrade.sql against it instead.
-- How to run (SQL Server 2012 or newer), pick one:
--   npm run db:init                                   (uses server/.env)
--   SSMS: File > Open > init.sql, then Execute (F5)
--   sqlcmd -S <server> -E -b -i database\init.sql     (-E = Windows login, or -U sa -P <password>)
-- ============================================================

IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'TempleApp')
BEGIN CREATE DATABASE TempleApp; END
GO
USE TempleApp;
GO

-- 1. Roles
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Roles]') AND type = 'U')
BEGIN CREATE TABLE [dbo].[Roles] (RoleId INT IDENTITY(1,1) PRIMARY KEY, RoleName NVARCHAR(50) NOT NULL, Description NVARCHAR(200), IsActive BIT DEFAULT 1, IsSuperAdmin BIT DEFAULT 0, CreatedAt DATETIME DEFAULT GETDATE()); END
GO
IF COL_LENGTH('dbo.Roles','IsSuperAdmin') IS NULL BEGIN ALTER TABLE Roles ADD IsSuperAdmin BIT DEFAULT 0; END
GO

-- 2. Users
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Users]') AND type = 'U')
BEGIN CREATE TABLE [dbo].[Users] (UserId INT IDENTITY(1,1) PRIMARY KEY, Username NVARCHAR(50) UNIQUE NOT NULL, PasswordHash NVARCHAR(255) NOT NULL, FullName NVARCHAR(100), Mobile NVARCHAR(15), Email NVARCHAR(100), RoleId INT, IsActive BIT DEFAULT 1, CreatedAt DATETIME DEFAULT GETDATE(), UpdatedAt DATETIME DEFAULT GETDATE(), CONSTRAINT FK_Users_Roles FOREIGN KEY (RoleId) REFERENCES Roles(RoleId)); END
GO

-- 3. Screens
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Screens]') AND type = 'U')
BEGIN CREATE TABLE [dbo].[Screens] (ScreenId INT IDENTITY(1,1) PRIMARY KEY, ScreenKey NVARCHAR(50) UNIQUE NOT NULL, ScreenName NVARCHAR(100) NOT NULL, ScreenGroup NVARCHAR(50), DisplayOrder INT DEFAULT 0, IsActive BIT DEFAULT 1); END
GO

-- 4. ScreenPermissions
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ScreenPermissions]') AND type = 'U')
BEGIN CREATE TABLE [dbo].[ScreenPermissions] (PermissionId INT IDENTITY(1,1) PRIMARY KEY, RoleId INT NOT NULL, ScreenId INT NOT NULL, CanView BIT DEFAULT 0, CanCreate BIT DEFAULT 0, CanEdit BIT DEFAULT 0, CanDelete BIT DEFAULT 0, CONSTRAINT FK_ScreenPerm_Roles FOREIGN KEY (RoleId) REFERENCES Roles(RoleId), CONSTRAINT FK_ScreenPerm_Screens FOREIGN KEY (ScreenId) REFERENCES Screens(ScreenId), CONSTRAINT UQ_RoleScreen UNIQUE (RoleId, ScreenId)); END
GO

-- 5. Locations (NEW in v2) - dynamic: Uttara Tirupati is just one row
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Locations]') AND type = 'U')
BEGIN CREATE TABLE [dbo].[Locations] (LocationId INT IDENTITY(1,1) PRIMARY KEY, LocationName NVARCHAR(100) UNIQUE NOT NULL, Description NVARCHAR(500), Address NVARCHAR(300), IsActive BIT DEFAULT 1, DisplayOrder INT DEFAULT 0, CreatedBy INT, CreatedAt DATETIME DEFAULT GETDATE(), UpdatedAt DATETIME DEFAULT GETDATE(), CONSTRAINT FK_Locations_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES Users(UserId)); END
GO

-- 6. Temples (+ LocationId in v2)
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Temples]') AND type = 'U')
BEGIN CREATE TABLE [dbo].[Temples] (TempleId INT IDENTITY(1,1) PRIMARY KEY, LocationId INT NULL, TempleName NVARCHAR(100) NOT NULL, Description NVARCHAR(500), Address NVARCHAR(300), IsMainTemple BIT DEFAULT 0, IsActive BIT DEFAULT 1, DisplayOrder INT DEFAULT 0, CreatedBy INT, CreatedAt DATETIME DEFAULT GETDATE(), UpdatedAt DATETIME DEFAULT GETDATE(), CONSTRAINT FK_Temples_Locations FOREIGN KEY (LocationId) REFERENCES Locations(LocationId), CONSTRAINT FK_Temples_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES Users(UserId)); END
GO
IF COL_LENGTH('dbo.Temples','LocationId') IS NULL BEGIN ALTER TABLE Temples ADD LocationId INT NULL; END
GO

-- 7. Deities
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Deities]') AND type = 'U')
BEGIN CREATE TABLE [dbo].[Deities] (DeityId INT IDENTITY(1,1) PRIMARY KEY, TempleId INT NOT NULL, DeityName NVARCHAR(100) NOT NULL, Description NVARCHAR(500), IsMainDeity BIT DEFAULT 0, IsActive BIT DEFAULT 1, DisplayOrder INT DEFAULT 0, CreatedBy INT, CreatedAt DATETIME DEFAULT GETDATE(), UpdatedAt DATETIME DEFAULT GETDATE(), CONSTRAINT FK_Deities_Temples FOREIGN KEY (TempleId) REFERENCES Temples(TempleId), CONSTRAINT FK_Deities_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES Users(UserId)); END
GO

-- 8. SevaCategories
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[SevaCategories]') AND type = 'U')
BEGIN CREATE TABLE [dbo].[SevaCategories] (CategoryId INT IDENTITY(1,1) PRIMARY KEY, CategoryName NVARCHAR(50) UNIQUE NOT NULL, IsActive BIT DEFAULT 1); END
GO

-- 9. SevaMaster
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[SevaMaster]') AND type = 'U')
BEGIN CREATE TABLE [dbo].[SevaMaster] (SevaId INT IDENTITY(1,1) PRIMARY KEY, TempleId INT NOT NULL, DeityId INT NULL, CategoryId INT NOT NULL, SevaName NVARCHAR(150) NOT NULL, Amount DECIMAL(10,2) NOT NULL, Description NVARCHAR(300), IsActive BIT DEFAULT 1, CreatedBy INT, CreatedAt DATETIME DEFAULT GETDATE(), UpdatedAt DATETIME DEFAULT GETDATE(), CONSTRAINT FK_SevaMaster_Temples FOREIGN KEY (TempleId) REFERENCES Temples(TempleId), CONSTRAINT FK_SevaMaster_Deities FOREIGN KEY (DeityId) REFERENCES Deities(DeityId), CONSTRAINT FK_SevaMaster_Categories FOREIGN KEY (CategoryId) REFERENCES SevaCategories(CategoryId), CONSTRAINT FK_SevaMaster_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES Users(UserId)); END
GO

-- 10. Counters
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Counters]') AND type = 'U')
BEGIN CREATE TABLE [dbo].[Counters] (CounterId INT IDENTITY(1,1) PRIMARY KEY, CounterName NVARCHAR(50) NOT NULL, Location NVARCHAR(100), IsActive BIT DEFAULT 1, AssignedUserId INT NULL, CONSTRAINT FK_Counters_Users FOREIGN KEY (AssignedUserId) REFERENCES Users(UserId)); END
GO

-- 11. Bookings (+ LocationId, SevaTime in v2)
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Bookings]') AND type = 'U')
BEGIN CREATE TABLE [dbo].[Bookings] (BookingId INT IDENTITY(1,1) PRIMARY KEY, BookingNumber NVARCHAR(20) UNIQUE NOT NULL, TokenNumber NVARCHAR(20) NOT NULL, BookingType NVARCHAR(20) NOT NULL, LocationId INT NULL, TempleId INT, DeityId INT NULL, DevoteeName NVARCHAR(100) NOT NULL, Mobile NVARCHAR(15) NOT NULL, Gothram NVARCHAR(100), Nakshatram NVARCHAR(50), BookingDate DATE NOT NULL, SevaDate DATE, SevaTime NVARCHAR(5) NULL, Remarks NVARCHAR(300), TotalAmount DECIMAL(10,2), PaymentMode NVARCHAR(20), PaymentStatus NVARCHAR(20) DEFAULT 'Paid', CounterId INT, CreatedBy INT, CreatedAt DATETIME DEFAULT GETDATE(), CancelledAt DATETIME NULL, CancelledBy INT NULL, IsAdvanceBooking BIT DEFAULT 0, CONSTRAINT FK_Bookings_Locations FOREIGN KEY (LocationId) REFERENCES Locations(LocationId), CONSTRAINT FK_Bookings_Temples FOREIGN KEY (TempleId) REFERENCES Temples(TempleId), CONSTRAINT FK_Bookings_Deities FOREIGN KEY (DeityId) REFERENCES Deities(DeityId), CONSTRAINT FK_Bookings_Counters FOREIGN KEY (CounterId) REFERENCES Counters(CounterId), CONSTRAINT FK_Bookings_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES Users(UserId), CONSTRAINT FK_Bookings_CancelledBy FOREIGN KEY (CancelledBy) REFERENCES Users(UserId)); END
GO
IF COL_LENGTH('dbo.Bookings','LocationId') IS NULL BEGIN ALTER TABLE Bookings ADD LocationId INT NULL; END
GO
IF COL_LENGTH('dbo.Bookings','SevaTime') IS NULL BEGIN ALTER TABLE Bookings ADD SevaTime NVARCHAR(5) NULL; END
GO

-- 12. BookingItems (multi-seva: one row per selected seva)
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[BookingItems]') AND type = 'U')
BEGIN CREATE TABLE [dbo].[BookingItems] (ItemId INT IDENTITY(1,1) PRIMARY KEY, BookingId INT NOT NULL, SevaId INT NULL, ItemName NVARCHAR(150) NOT NULL, Quantity INT DEFAULT 1, UnitAmount DECIMAL(10,2), TotalAmount DECIMAL(10,2), CreatedAt DATETIME DEFAULT GETDATE(), CONSTRAINT FK_BookingItems_Bookings FOREIGN KEY (BookingId) REFERENCES Bookings(BookingId), CONSTRAINT FK_BookingItems_SevaMaster FOREIGN KEY (SevaId) REFERENCES SevaMaster(SevaId)); END
GO

-- 13. LifetimeMembers
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[LifetimeMembers]') AND type = 'U')
BEGIN CREATE TABLE [dbo].[LifetimeMembers] (MemberId INT IDENTITY(1,1) PRIMARY KEY, MemberNumber NVARCHAR(20) UNIQUE, MemberName NVARCHAR(100) NOT NULL, Mobile NVARCHAR(15) NOT NULL, Email NVARCHAR(100), Address NVARCHAR(300), TempleId INT, DeityId INT, PoojaName NVARCHAR(100), NextPoojaDate DATE, Frequency NVARCHAR(20), Status NVARCHAR(20) DEFAULT 'Active', CreatedBy INT, CreatedAt DATETIME DEFAULT GETDATE(), UpdatedAt DATETIME DEFAULT GETDATE(), CONSTRAINT FK_LifeMembers_Temples FOREIGN KEY (TempleId) REFERENCES Temples(TempleId), CONSTRAINT FK_LifeMembers_Deities FOREIGN KEY (DeityId) REFERENCES Deities(DeityId), CONSTRAINT FK_LifeMembers_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES Users(UserId)); END
GO

-- 14. AuditLog
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[AuditLog]') AND type = 'U')
BEGIN CREATE TABLE [dbo].[AuditLog] (LogId BIGINT IDENTITY(1,1) PRIMARY KEY, UserId INT, Action NVARCHAR(50), TableName NVARCHAR(50), RecordId INT, OldValues NVARCHAR(MAX), NewValues NVARCHAR(MAX), IPAddress NVARCHAR(50), CreatedAt DATETIME DEFAULT GETDATE(), CONSTRAINT FK_AuditLog_Users FOREIGN KEY (UserId) REFERENCES Users(UserId)); END
GO

-- 15. SevaTimeSlots (NEW in v2, optional)
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[SevaTimeSlots]') AND type = 'U')
BEGIN CREATE TABLE [dbo].[SevaTimeSlots] (SlotId INT IDENTITY(1,1) PRIMARY KEY, TempleId INT NULL, SlotTime NVARCHAR(5) NOT NULL, SlotLabel NVARCHAR(50), IsActive BIT DEFAULT 1, DisplayOrder INT DEFAULT 0, CONSTRAINT FK_Slots_Temples FOREIGN KEY (TempleId) REFERENCES Temples(TempleId)); END
GO


-- 16. BookingTypes (dynamic lookup - token prefix per type)
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[BookingTypes]') AND type = 'U')
BEGIN CREATE TABLE [dbo].[BookingTypes] (BookingTypeId INT IDENTITY(1,1) PRIMARY KEY, TypeName NVARCHAR(50) UNIQUE NOT NULL, TokenPrefix NVARCHAR(10) NOT NULL, IsActive BIT DEFAULT 1, IsDefault BIT DEFAULT 0, DisplayOrder INT DEFAULT 0); END
GO
-- 17. PaymentModes (dynamic lookup)
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[PaymentModes]') AND type = 'U')
BEGIN CREATE TABLE [dbo].[PaymentModes] (PaymentModeId INT IDENTITY(1,1) PRIMARY KEY, ModeName NVARCHAR(50) UNIQUE NOT NULL, IsActive BIT DEFAULT 1, IsDefault BIT DEFAULT 0, DisplayOrder INT DEFAULT 0); END
GO
-- 18. BookingStatuses (dynamic lookup)
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[BookingStatuses]') AND type = 'U')
BEGIN CREATE TABLE [dbo].[BookingStatuses] (BookingStatusId INT IDENTITY(1,1) PRIMARY KEY, StatusName NVARCHAR(50) UNIQUE NOT NULL, IsActive BIT DEFAULT 1, IsDefault BIT DEFAULT 0, DisplayOrder INT DEFAULT 0); END
GO
-- 19. MemberFrequencies (dynamic lookup)
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[MemberFrequencies]') AND type = 'U')
BEGIN CREATE TABLE [dbo].[MemberFrequencies] (FrequencyId INT IDENTITY(1,1) PRIMARY KEY, FrequencyName NVARCHAR(50) UNIQUE NOT NULL, IsActive BIT DEFAULT 1, IsDefault BIT DEFAULT 0, DisplayOrder INT DEFAULT 0); END
GO
-- 20. MemberStatuses (dynamic lookup)
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[MemberStatuses]') AND type = 'U')
BEGIN CREATE TABLE [dbo].[MemberStatuses] (MemberStatusId INT IDENTITY(1,1) PRIMARY KEY, StatusName NVARCHAR(50) UNIQUE NOT NULL, IsActive BIT DEFAULT 1, IsDefault BIT DEFAULT 0, DisplayOrder INT DEFAULT 0); END
GO

-- ============================================================
-- STORED PROCEDURES (from v1)
-- ============================================================
IF OBJECT_ID(N'[dbo].[sp_GenerateBookingNumber]', 'P') IS NOT NULL DROP PROCEDURE [dbo].[sp_GenerateBookingNumber];
GO
CREATE PROCEDURE [dbo].[sp_GenerateBookingNumber] @BookingNumber NVARCHAR(20) OUTPUT AS
BEGIN SET NOCOUNT ON; DECLARE @Today DATE = GETDATE(); DECLARE @DatePart NVARCHAR(8) = FORMAT(@Today, 'yyyyMMdd'); DECLARE @MaxSeq INT;
SELECT @MaxSeq = ISNULL(MAX(CAST(RIGHT(BookingNumber, 4) AS INT)), 0) FROM Bookings WHERE BookingNumber LIKE 'BK-' + @DatePart + '-%';
SET @BookingNumber = 'BK-' + @DatePart + '-' + RIGHT('0000' + CAST(@MaxSeq + 1 AS NVARCHAR), 4); END
GO
IF OBJECT_ID(N'[dbo].[sp_GenerateTokenNumber]', 'P') IS NOT NULL DROP PROCEDURE [dbo].[sp_GenerateTokenNumber];
GO
CREATE PROCEDURE [dbo].[sp_GenerateTokenNumber] @BookingType NVARCHAR(20), @TokenNumber NVARCHAR(20) OUTPUT AS
BEGIN SET NOCOUNT ON; DECLARE @Prefix NVARCHAR(10); DECLARE @MaxSeq INT;
-- Dynamic: prefix comes from BookingTypes master (no hardcoded CASE)
SELECT @Prefix = TokenPrefix FROM BookingTypes WHERE TypeName = @BookingType AND IsActive = 1;
IF @Prefix IS NULL SET @Prefix = 'TK';
SELECT @MaxSeq = ISNULL(MAX(CAST(RIGHT(TokenNumber, 5) AS INT)), 0) FROM Bookings WHERE TokenNumber LIKE @Prefix + '-%';
SET @TokenNumber = @Prefix + '-' + RIGHT('00000' + CAST(@MaxSeq + 1 AS NVARCHAR), 5); END
GO

-- ============================================================
-- SEED DATA
-- ============================================================
IF NOT EXISTS (SELECT 1 FROM Roles WHERE RoleName = 'SuperAdmin') INSERT INTO Roles (RoleName, Description) VALUES ('SuperAdmin', 'Full system access');
IF NOT EXISTS (SELECT 1 FROM Roles WHERE RoleName = 'Admin') INSERT INTO Roles (RoleName, Description) VALUES ('Admin', 'Manage temples, sevas and users');
IF NOT EXISTS (SELECT 1 FROM Roles WHERE RoleName = 'Operator') INSERT INTO Roles (RoleName, Description) VALUES ('Operator', 'Counter operator for booking sevas');
IF NOT EXISTS (SELECT 1 FROM Roles WHERE RoleName = 'Viewer') INSERT INTO Roles (RoleName, Description) VALUES ('Viewer', 'Read-only reports and dashboard');
GO

-- bcrypt hashes: admin123 / manager123 / operator123 / viewer123 (generated with bcryptjs, 10 rounds)
IF NOT EXISTS (SELECT 1 FROM Users WHERE Username = 'admin')
    INSERT INTO Users (Username, PasswordHash, FullName, Mobile, Email, RoleId, IsActive)
    VALUES ('admin', '$2a$10$kKh9WONaoU6e73uBCzdqk.LE8pLgheryn7yrth42Vd.NPL78n5jou', 'System Administrator', '9999999999', 'admin@example.org', (SELECT RoleId FROM Roles WHERE RoleName='SuperAdmin'), 1);
GO

IF NOT EXISTS (SELECT 1 FROM Screens WHERE ScreenKey = 'overview')
BEGIN
    INSERT INTO Screens (ScreenKey, ScreenName, ScreenGroup, DisplayOrder) VALUES
    ('overview','Overview','Operations',1),('seva_booking','Seva Booking','Operations',2),('bookings','Bookings','Operations',3),
    ('lifetime_members','Lifetime Members','Operations',4),('reports','Reports','Reports',5),
    ('locations','Locations','Administration',6),('temple_mgmt','Temples','Administration',7),('deity_mgmt','Deities','Administration',8),
    ('seva_master','Seva Master','Administration',9),('seva_categories','Seva Categories','Administration',10),
    ('counters','Counters','Administration',11),('user_mgmt','User Management','Administration',12),('screen_allocation','Screen Allocation','Administration',13);
END
GO

DECLARE @SuperAdminRoleId INT; SELECT @SuperAdminRoleId = RoleId FROM Roles WHERE RoleName = 'SuperAdmin';
IF @SuperAdminRoleId IS NOT NULL
BEGIN INSERT INTO ScreenPermissions (RoleId, ScreenId, CanView, CanCreate, CanEdit, CanDelete)
SELECT @SuperAdminRoleId, s.ScreenId, 1,1,1,1 FROM Screens s
WHERE NOT EXISTS (SELECT 1 FROM ScreenPermissions sp WHERE sp.RoleId=@SuperAdminRoleId AND sp.ScreenId=s.ScreenId); END
GO

DECLARE @AdminUserId INT; SELECT @AdminUserId = UserId FROM Users WHERE Username='admin';

-- Locations (dynamic - add more rows any time)
IF NOT EXISTS (SELECT 1 FROM Locations WHERE LocationName='Uttara Tirupati')
BEGIN
    INSERT INTO Locations (LocationName, Description, Address, DisplayOrder, CreatedBy) VALUES
    ('Uttara Tirupati',N'Uttara Tirupati Kshetram ' + NCHAR(8212) + N' main pilgrimage complex','Uttara Tirupati, Hyderabad, Telangana',1,@AdminUserId),
    ('Tirupati Balaji','Sri Venkateswara Swamy Temple, Tirupati','Tirumala, Tirupati, Andhra Pradesh',2,@AdminUserId),
    ('Srisailam','Sri Mallikarjuna Swamy Temple, Srisailam','Srisailam, Nandyal, Andhra Pradesh',3,@AdminUserId);
END
GO

-- Temples (linked to Uttara Tirupati location)
DECLARE @AdminUserId INT; SELECT @AdminUserId = UserId FROM Users WHERE Username='admin';
IF NOT EXISTS (SELECT 1 FROM Temples WHERE TempleName='Venkateshwara Swami')
BEGIN
    DECLARE @Loc INT; SELECT @Loc = LocationId FROM Locations WHERE LocationName='Uttara Tirupati';
    INSERT INTO Temples (LocationId, TempleName, Description, IsMainTemple, DisplayOrder, CreatedBy) VALUES
    (@Loc,'Venkateshwara Swami','Main temple - Sri Venkateshwara Swami Temple',1,1,@AdminUserId),
    (@Loc,'General','General temple services and common sevas',0,2,@AdminUserId),
    (@Loc,'Dattatreya Swami','Sri Dattatreya Swami Temple',0,3,@AdminUserId),
    (@Loc,'Anjaneya Swami','Sri Anjaneya Swami Temple',0,4,@AdminUserId),
    (@Loc,'Padmavathi Ammavaru','Sri Padmavathi Ammavaru Temple',0,5,@AdminUserId),
    (@Loc,'Lord Shiva','Lord Shiva Temple',0,6,@AdminUserId),
    (@Loc,'Ganapathi','Sri Ganapathi Temple',0,7,@AdminUserId);
END
GO

-- Deities
DECLARE @AdminUserId INT; SELECT @AdminUserId = UserId FROM Users WHERE Username='admin';
IF NOT EXISTS (SELECT 1 FROM Deities WHERE DeityName='Sri Venkateshwara Swami')
BEGIN
    INSERT INTO Deities (TempleId, DeityName, Description, IsMainDeity, DisplayOrder, CreatedBy)
    SELECT t.TempleId, CASE t.TempleName WHEN 'Venkateshwara Swami' THEN 'Sri Venkateshwara Swami' WHEN 'General' THEN 'General Deity' WHEN 'Dattatreya Swami' THEN 'Sri Dattatreya Swami' WHEN 'Anjaneya Swami' THEN 'Sri Anjaneya Swami' WHEN 'Padmavathi Ammavaru' THEN 'Sri Padmavathi Ammavaru' WHEN 'Lord Shiva' THEN 'Lord Shiva' WHEN 'Ganapathi' THEN 'Sri Ganapathi' END, 'Main deity of ' + t.TempleName + ' Temple', 1, 1, @AdminUserId
    FROM Temples t WHERE t.LocationId = (SELECT LocationId FROM Locations WHERE LocationName='Uttara Tirupati');
END
GO

IF NOT EXISTS (SELECT 1 FROM SevaCategories WHERE CategoryName='Abhishekam')
    INSERT INTO SevaCategories (CategoryName) VALUES ('Abhishekam'),('Archana'),('Alankara'),('Kalyanam'),('Homam'),('Pooja'),('Vratam'),('Naivedya'),('Seva'),('Other');
GO

-- Sevas: see init-v1-original.sql for the full 35-row seed (same data). The app seeds identical data in demo mode.
-- Counters
IF NOT EXISTS (SELECT 1 FROM Counters WHERE CounterName='Seva Counter 01')
    INSERT INTO Counters (CounterName, Location, IsActive) VALUES ('Seva Counter 01','Main Hall - Counter 1',1),('Seva Counter 02','Main Hall - Counter 2',1),('Laddu Counter 01','Prasadam Hall',1),('Goshala Counter 01','Goshala Entrance',1);
GO


-- Lookup seeds (dynamic masters - edit these rows, no code change needed)
IF NOT EXISTS (SELECT 1 FROM BookingTypes WHERE TypeName='Seva') INSERT INTO BookingTypes (TypeName, TokenPrefix, IsDefault, DisplayOrder) VALUES ('Seva','SV',1,1),('Laddu','LD',0,2),('Goshala','GH',0,3);
IF NOT EXISTS (SELECT 1 FROM PaymentModes WHERE ModeName='Cash') INSERT INTO PaymentModes (ModeName, IsDefault, DisplayOrder) VALUES ('Cash',1,1),('UPI',0,2),('Pine Labs',0,3);
IF NOT EXISTS (SELECT 1 FROM BookingStatuses WHERE StatusName='Paid') INSERT INTO BookingStatuses (StatusName, IsDefault, DisplayOrder) VALUES ('Paid',1,1),('Pending',0,2),('Cancelled',0,3),('Refunded',0,4);
IF NOT EXISTS (SELECT 1 FROM MemberFrequencies WHERE FrequencyName='Annual') INSERT INTO MemberFrequencies (FrequencyName, IsDefault, DisplayOrder) VALUES ('Annual',1,1),('Monthly',0,2),('One-time',0,3),('Custom',0,4);
IF NOT EXISTS (SELECT 1 FROM MemberStatuses WHERE StatusName='Active') INSERT INTO MemberStatuses (StatusName, IsDefault, DisplayOrder) VALUES ('Active',1,1),('Inactive',0,2),('Expired',0,3);
IF NOT EXISTS (SELECT 1 FROM Screens WHERE ScreenKey='booking_types') INSERT INTO Screens (ScreenKey, ScreenName, ScreenGroup, DisplayOrder) VALUES ('booking_types','Booking Types','Masters',14),('payment_modes','Payment Modes','Masters',15),('booking_statuses','Booking Statuses','Masters',16),('time_slots','Seva Time Slots','Masters',17),('member_frequencies','Member Frequencies','Masters',18),('member_statuses','Member Statuses','Masters',19);
UPDATE Roles SET IsSuperAdmin = 1 WHERE RoleName = 'SuperAdmin';

GO

-- >>> v4 block - generated by database/generate-sql.mjs from database/seed.json; regenerate instead of editing by hand >>>
-- ============================================================
-- Temple Seva Booking - v4 upgrade: location chosen at login + separate items per booking type
-- Generated by database/generate-sql.mjs from database/seed.json (generator input only - the app keeps all data in MSSQL).
-- Upgrades a database created by the ORIGINAL init.sql (v1) or by an earlier version of this app (v2, v3).
-- Idempotent - safe to re-run - and it never overwrites your edits: seed rows are only added where
-- nothing exists yet (temples for a location without temples, sevas for a temple without sevas,
-- items into an empty Item Master, demo users only while 'admin' is the only user, ...).
--   v2  Locations, Temples.LocationId, Bookings.LocationId / SevaTime, SevaTimeSlots
--   v3  lookup masters (BookingTypes, PaymentModes, BookingStatuses, MemberFrequencies, MemberStatuses),
--       Roles.IsSuperAdmin, hardcoded CHECK constraints dropped
--   v4  Locations: LocationCode, Phone, Email, ReceiptFooter (login picker, header, receipts)
--       Users.AllLocations + UserLocations (where a user may sign in; existing users keep every location)
--       LocationId on Counters, LifetimeMembers, SevaTimeSlots, AuditLog (location-scoped data)
--       BookingTypes: ScreenKey, Description, Icon, UsesSevaMaster, RequiresTemple, RequiresSchedule,
--                     RequiresDevotee, CaptureGothram, AllowAdvance (each type = own screen, items, rules)
--       ItemMaster (Laddu / Goshala / ... items and prices per location) + BookingItems.MasterItemId
--       Bookings: BookingTypeId, CancelReason, UpdatedAt, UpdatedBy; lookup-value columns widened
--       BookingStatuses.IsCancelled, Screens.IsBookingScreen, SevaCategories.DisplayOrder, AppSettings
--       number generators read their prefixes from AppSettings; admin password hash from v1 fixed
--   v4.1 numbers restart every financial year (sp_NextNumber + NumberSequences, formats in AppSettings),
--       UPI payment QR (Locations.UpiVpa / UpiPayeeName, PaymentModes.ShowUpiQr), devotee lookup indexes
--   v4.2 who created / changed every record: CreatedBy, CreatedAt, UpdatedBy, UpdatedAt (+ FKs to Users) on all
--       user-maintained tables; branding settings (brandName, brandLogoUrl, brandIconUrl)
-- In init.sql this block runs automatically after the base schema above.
-- ============================================================
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

-- ---------- 0. Earlier versions (v1 -> v3): locations, time slots, lookup masters ----------
IF COL_LENGTH('dbo.Roles', 'IsSuperAdmin') IS NULL ALTER TABLE dbo.Roles ADD IsSuperAdmin BIT NOT NULL CONSTRAINT DF_Roles_IsSuperAdmin DEFAULT 0;
IF OBJECT_ID(N'dbo.Locations', N'U') IS NULL
    CREATE TABLE dbo.Locations (LocationId INT IDENTITY(1,1) PRIMARY KEY, LocationName NVARCHAR(100) NOT NULL UNIQUE, Description NVARCHAR(500) NULL, Address NVARCHAR(300) NULL, IsActive BIT DEFAULT 1, DisplayOrder INT DEFAULT 0, CreatedBy INT NULL CONSTRAINT FK_Locations_CreatedBy REFERENCES dbo.Users(UserId), CreatedAt DATETIME DEFAULT GETDATE(), UpdatedAt DATETIME DEFAULT GETDATE());
IF OBJECT_ID(N'dbo.SevaTimeSlots', N'U') IS NULL
    CREATE TABLE dbo.SevaTimeSlots (SlotId INT IDENTITY(1,1) PRIMARY KEY, TempleId INT NULL CONSTRAINT FK_Slots_Temples REFERENCES dbo.Temples(TempleId), SlotTime NVARCHAR(5) NOT NULL, SlotLabel NVARCHAR(50) NULL, IsActive BIT DEFAULT 1, DisplayOrder INT DEFAULT 0);
IF OBJECT_ID(N'dbo.BookingTypes', N'U') IS NULL
    CREATE TABLE dbo.BookingTypes (BookingTypeId INT IDENTITY(1,1) PRIMARY KEY, TypeName NVARCHAR(50) NOT NULL UNIQUE, TokenPrefix NVARCHAR(10) NOT NULL, IsActive BIT DEFAULT 1, IsDefault BIT DEFAULT 0, DisplayOrder INT DEFAULT 0);
IF OBJECT_ID(N'dbo.PaymentModes', N'U') IS NULL
    CREATE TABLE dbo.PaymentModes (PaymentModeId INT IDENTITY(1,1) PRIMARY KEY, ModeName NVARCHAR(50) NOT NULL UNIQUE, IsActive BIT DEFAULT 1, IsDefault BIT DEFAULT 0, DisplayOrder INT DEFAULT 0);
IF OBJECT_ID(N'dbo.BookingStatuses', N'U') IS NULL
    CREATE TABLE dbo.BookingStatuses (BookingStatusId INT IDENTITY(1,1) PRIMARY KEY, StatusName NVARCHAR(50) NOT NULL UNIQUE, IsActive BIT DEFAULT 1, IsDefault BIT DEFAULT 0, DisplayOrder INT DEFAULT 0);
IF OBJECT_ID(N'dbo.MemberFrequencies', N'U') IS NULL
    CREATE TABLE dbo.MemberFrequencies (FrequencyId INT IDENTITY(1,1) PRIMARY KEY, FrequencyName NVARCHAR(50) NOT NULL UNIQUE, IsActive BIT DEFAULT 1, IsDefault BIT DEFAULT 0, DisplayOrder INT DEFAULT 0);
IF OBJECT_ID(N'dbo.MemberStatuses', N'U') IS NULL
    CREATE TABLE dbo.MemberStatuses (MemberStatusId INT IDENTITY(1,1) PRIMARY KEY, StatusName NVARCHAR(50) NOT NULL UNIQUE, IsActive BIT DEFAULT 1, IsDefault BIT DEFAULT 0, DisplayOrder INT DEFAULT 0);
-- values now come from the lookup masters, so the hardcoded CHECK lists from v1 go
IF OBJECT_ID(N'dbo.CK_Bookings_Type', N'C') IS NOT NULL ALTER TABLE dbo.Bookings DROP CONSTRAINT CK_Bookings_Type;
IF OBJECT_ID(N'dbo.CK_Bookings_PayMode', N'C') IS NOT NULL ALTER TABLE dbo.Bookings DROP CONSTRAINT CK_Bookings_PayMode;
IF OBJECT_ID(N'dbo.CK_Bookings_PayStatus', N'C') IS NOT NULL ALTER TABLE dbo.Bookings DROP CONSTRAINT CK_Bookings_PayStatus;
IF OBJECT_ID(N'dbo.CK_LifeMembers_Freq', N'C') IS NOT NULL ALTER TABLE dbo.LifetimeMembers DROP CONSTRAINT CK_LifeMembers_Freq;
IF OBJECT_ID(N'dbo.CK_LifeMembers_Status', N'C') IS NOT NULL ALTER TABLE dbo.LifetimeMembers DROP CONSTRAINT CK_LifeMembers_Status;
GO

-- ---------- 1. New columns ----------
IF COL_LENGTH('dbo.Temples', 'LocationId') IS NULL ALTER TABLE dbo.Temples ADD LocationId INT NULL CONSTRAINT FK_Temples_Locations REFERENCES dbo.Locations(LocationId);
IF COL_LENGTH('dbo.Bookings', 'LocationId') IS NULL ALTER TABLE dbo.Bookings ADD LocationId INT NULL CONSTRAINT FK_Bookings_Locations REFERENCES dbo.Locations(LocationId);
IF COL_LENGTH('dbo.Bookings', 'SevaTime') IS NULL ALTER TABLE dbo.Bookings ADD SevaTime NVARCHAR(5) NULL;
IF COL_LENGTH('dbo.Locations', 'LocationCode') IS NULL ALTER TABLE dbo.Locations ADD LocationCode NVARCHAR(10) NULL;
IF COL_LENGTH('dbo.Locations', 'Phone') IS NULL ALTER TABLE dbo.Locations ADD Phone NVARCHAR(30) NULL;
IF COL_LENGTH('dbo.Locations', 'Email') IS NULL ALTER TABLE dbo.Locations ADD Email NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.Locations', 'ReceiptFooter') IS NULL ALTER TABLE dbo.Locations ADD ReceiptFooter NVARCHAR(300) NULL;
-- added nullable first: existing users are granted every location below, then it becomes NOT NULL DEFAULT 0
IF COL_LENGTH('dbo.Users', 'AllLocations') IS NULL ALTER TABLE dbo.Users ADD AllLocations BIT NULL;
IF COL_LENGTH('dbo.Counters', 'LocationId') IS NULL ALTER TABLE dbo.Counters ADD LocationId INT NULL CONSTRAINT FK_Counters_Locations REFERENCES dbo.Locations(LocationId);
IF COL_LENGTH('dbo.LifetimeMembers', 'LocationId') IS NULL ALTER TABLE dbo.LifetimeMembers ADD LocationId INT NULL CONSTRAINT FK_LifeMembers_Locations REFERENCES dbo.Locations(LocationId);
IF COL_LENGTH('dbo.SevaTimeSlots', 'LocationId') IS NULL ALTER TABLE dbo.SevaTimeSlots ADD LocationId INT NULL CONSTRAINT FK_Slots_Locations REFERENCES dbo.Locations(LocationId);
IF COL_LENGTH('dbo.AuditLog', 'LocationId') IS NULL ALTER TABLE dbo.AuditLog ADD LocationId INT NULL;
IF COL_LENGTH('dbo.BookingTypes', 'ScreenKey') IS NULL ALTER TABLE dbo.BookingTypes ADD ScreenKey NVARCHAR(50) NULL;
IF COL_LENGTH('dbo.BookingTypes', 'Description') IS NULL ALTER TABLE dbo.BookingTypes ADD Description NVARCHAR(200) NULL;
IF COL_LENGTH('dbo.BookingTypes', 'Icon') IS NULL ALTER TABLE dbo.BookingTypes ADD Icon NVARCHAR(30) NULL;
IF COL_LENGTH('dbo.BookingTypes', 'UsesSevaMaster') IS NULL ALTER TABLE dbo.BookingTypes ADD UsesSevaMaster BIT NOT NULL CONSTRAINT DF_BookingTypes_UsesSevaMaster DEFAULT 0;
IF COL_LENGTH('dbo.BookingTypes', 'RequiresTemple') IS NULL ALTER TABLE dbo.BookingTypes ADD RequiresTemple BIT NOT NULL CONSTRAINT DF_BookingTypes_RequiresTemple DEFAULT 0;
IF COL_LENGTH('dbo.BookingTypes', 'RequiresSchedule') IS NULL ALTER TABLE dbo.BookingTypes ADD RequiresSchedule BIT NOT NULL CONSTRAINT DF_BookingTypes_RequiresSchedule DEFAULT 0;
IF COL_LENGTH('dbo.BookingTypes', 'RequiresDevotee') IS NULL ALTER TABLE dbo.BookingTypes ADD RequiresDevotee BIT NOT NULL CONSTRAINT DF_BookingTypes_RequiresDevotee DEFAULT 1;
IF COL_LENGTH('dbo.BookingTypes', 'CaptureGothram') IS NULL ALTER TABLE dbo.BookingTypes ADD CaptureGothram BIT NOT NULL CONSTRAINT DF_BookingTypes_CaptureGothram DEFAULT 0;
IF COL_LENGTH('dbo.BookingTypes', 'AllowAdvance') IS NULL ALTER TABLE dbo.BookingTypes ADD AllowAdvance BIT NOT NULL CONSTRAINT DF_BookingTypes_AllowAdvance DEFAULT 1;
IF COL_LENGTH('dbo.BookingStatuses', 'IsCancelled') IS NULL ALTER TABLE dbo.BookingStatuses ADD IsCancelled BIT NOT NULL CONSTRAINT DF_BookingStatuses_IsCancelled DEFAULT 0;
IF COL_LENGTH('dbo.Screens', 'IsBookingScreen') IS NULL ALTER TABLE dbo.Screens ADD IsBookingScreen BIT NOT NULL CONSTRAINT DF_Screens_IsBookingScreen DEFAULT 0;
IF COL_LENGTH('dbo.SevaCategories', 'DisplayOrder') IS NULL ALTER TABLE dbo.SevaCategories ADD DisplayOrder INT NOT NULL CONSTRAINT DF_SevaCategories_DisplayOrder DEFAULT 0;
IF COL_LENGTH('dbo.Bookings', 'BookingTypeId') IS NULL ALTER TABLE dbo.Bookings ADD BookingTypeId INT NULL CONSTRAINT FK_Bookings_BookingTypes REFERENCES dbo.BookingTypes(BookingTypeId);
IF COL_LENGTH('dbo.Bookings', 'CancelReason') IS NULL ALTER TABLE dbo.Bookings ADD CancelReason NVARCHAR(300) NULL;
IF COL_LENGTH('dbo.Bookings', 'UpdatedAt') IS NULL ALTER TABLE dbo.Bookings ADD UpdatedAt DATETIME NULL;
IF COL_LENGTH('dbo.Bookings', 'UpdatedBy') IS NULL ALTER TABLE dbo.Bookings ADD UpdatedBy INT NULL CONSTRAINT FK_Bookings_UpdatedBy REFERENCES dbo.Users(UserId);
-- lookup values are stored by name: widen to the lookup name size; longer number prefixes fit too
IF COL_LENGTH('dbo.Bookings', 'BookingType') < 100 ALTER TABLE dbo.Bookings ALTER COLUMN BookingType NVARCHAR(50) NOT NULL;
IF COL_LENGTH('dbo.Bookings', 'PaymentMode') < 100 ALTER TABLE dbo.Bookings ALTER COLUMN PaymentMode NVARCHAR(50) NULL;
IF COL_LENGTH('dbo.Bookings', 'PaymentStatus') < 100 ALTER TABLE dbo.Bookings ALTER COLUMN PaymentStatus NVARCHAR(50) NULL;
IF COL_LENGTH('dbo.LifetimeMembers', 'Frequency') < 100 ALTER TABLE dbo.LifetimeMembers ALTER COLUMN Frequency NVARCHAR(50) NULL;
IF COL_LENGTH('dbo.LifetimeMembers', 'Status') < 100 ALTER TABLE dbo.LifetimeMembers ALTER COLUMN Status NVARCHAR(50) NULL;
IF COL_LENGTH('dbo.Bookings', 'BookingNumber') < 60 ALTER TABLE dbo.Bookings ALTER COLUMN BookingNumber NVARCHAR(30) NOT NULL;
IF COL_LENGTH('dbo.LifetimeMembers', 'MemberNumber') < 60 ALTER TABLE dbo.LifetimeMembers ALTER COLUMN MemberNumber NVARCHAR(30) NULL;
IF COL_LENGTH('dbo.Bookings', 'TokenNumber') < 60 ALTER TABLE dbo.Bookings ALTER COLUMN TokenNumber NVARCHAR(30) NOT NULL;
-- v4.1: UPI payment QR (each location saves its own UPI ID) and the payment modes that show it
IF COL_LENGTH('dbo.Locations', 'UpiVpa') IS NULL ALTER TABLE dbo.Locations ADD UpiVpa NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.Locations', 'UpiPayeeName') IS NULL ALTER TABLE dbo.Locations ADD UpiPayeeName NVARCHAR(100) NULL;
IF COL_LENGTH('dbo.PaymentModes', 'ShowUpiQr') IS NULL ALTER TABLE dbo.PaymentModes ADD ShowUpiQr BIT NOT NULL CONSTRAINT DF_PaymentModes_ShowUpiQr DEFAULT 0;
GO

-- ---------- 1b. New tables ----------
IF OBJECT_ID(N'dbo.UserLocations', N'U') IS NULL
    CREATE TABLE dbo.UserLocations (
        UserId INT NOT NULL, LocationId INT NOT NULL,
        CONSTRAINT PK_UserLocations PRIMARY KEY (UserId, LocationId),
        CONSTRAINT FK_UserLocations_Users FOREIGN KEY (UserId) REFERENCES dbo.Users(UserId) ON DELETE CASCADE,
        CONSTRAINT FK_UserLocations_Locations FOREIGN KEY (LocationId) REFERENCES dbo.Locations(LocationId) ON DELETE CASCADE);
IF OBJECT_ID(N'dbo.ItemMaster', N'U') IS NULL
    CREATE TABLE dbo.ItemMaster (
        ItemId INT IDENTITY(1,1) PRIMARY KEY,
        LocationId INT NOT NULL, BookingTypeId INT NOT NULL, TempleId INT NULL,   -- TempleId NULL = every temple of the location
        ItemName NVARCHAR(150) NOT NULL, Amount DECIMAL(10,2) NOT NULL,
        AllowCustomAmount BIT NOT NULL CONSTRAINT DF_ItemMaster_AllowCustom DEFAULT 0,   -- donations: devotee enters the amount
        MinAmount DECIMAL(10,2) NOT NULL CONSTRAINT DF_ItemMaster_MinAmount DEFAULT 0,
        Unit NVARCHAR(30) NULL, Description NVARCHAR(300) NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_ItemMaster_IsActive DEFAULT 1,
        DisplayOrder INT NOT NULL CONSTRAINT DF_ItemMaster_DisplayOrder DEFAULT 0,
        CreatedBy INT NULL, CreatedAt DATETIME DEFAULT GETDATE(), UpdatedAt DATETIME DEFAULT GETDATE(),
        CONSTRAINT FK_ItemMaster_Locations FOREIGN KEY (LocationId) REFERENCES dbo.Locations(LocationId),
        CONSTRAINT FK_ItemMaster_BookingTypes FOREIGN KEY (BookingTypeId) REFERENCES dbo.BookingTypes(BookingTypeId),
        CONSTRAINT FK_ItemMaster_Temples FOREIGN KEY (TempleId) REFERENCES dbo.Temples(TempleId),
        CONSTRAINT FK_ItemMaster_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId),
        CONSTRAINT UQ_ItemMaster_LocTypeName UNIQUE (LocationId, BookingTypeId, ItemName));
IF OBJECT_ID(N'dbo.AppSettings', N'U') IS NULL
    CREATE TABLE dbo.AppSettings (SettingKey NVARCHAR(50) NOT NULL PRIMARY KEY, SettingValue NVARCHAR(500) NULL, UpdatedAt DATETIME DEFAULT GETDATE());
-- v4.1: one counter per number series and financial year (e.g. 'TOKEN|SV|2026-27'), so numbers restart every 1 April
IF OBJECT_ID(N'dbo.NumberSequences', N'U') IS NULL
    CREATE TABLE dbo.NumberSequences (SeqKey NVARCHAR(100) NOT NULL CONSTRAINT PK_NumberSequences PRIMARY KEY, LastValue INT NOT NULL, UpdatedAt DATETIME NULL CONSTRAINT DF_NumberSequences_UpdatedAt DEFAULT GETDATE());
GO
-- v4.1: fast devotee lookup by mobile number and fast location/date lists
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.Bookings') AND name = N'IX_Bookings_Mobile')
    CREATE NONCLUSTERED INDEX IX_Bookings_Mobile ON dbo.Bookings (Mobile) INCLUDE (DevoteeName, Gothram, Nakshatram, LocationId, BookingDate);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.Bookings') AND name = N'IX_Bookings_Location_Date')
    CREATE NONCLUSTERED INDEX IX_Bookings_Location_Date ON dbo.Bookings (LocationId, BookingDate);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.LifetimeMembers') AND name = N'IX_LifetimeMembers_Mobile')
    CREATE NONCLUSTERED INDEX IX_LifetimeMembers_Mobile ON dbo.LifetimeMembers (Mobile);
GO

-- BookingItems.ItemId is the line's own key, so the Item Master link is MasterItemId (API field: Items[].ItemId)
IF COL_LENGTH('dbo.BookingItems', 'MasterItemId') IS NULL ALTER TABLE dbo.BookingItems ADD MasterItemId INT NULL CONSTRAINT FK_BookingItems_ItemMaster REFERENCES dbo.ItemMaster(ItemId);
GO

-- users that existed before v4 keep access to every location; new users default to explicit locations
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.Users') AND name = N'AllLocations' AND is_nullable = 1)
BEGIN
    UPDATE dbo.Users SET AllLocations = 1 WHERE AllLocations IS NULL;
    ALTER TABLE dbo.Users ALTER COLUMN AllLocations BIT NOT NULL;
    IF OBJECT_ID(N'dbo.DF_Users_AllLocations', N'D') IS NULL ALTER TABLE dbo.Users ADD CONSTRAINT DF_Users_AllLocations DEFAULT 0 FOR AllLocations;
END
GO

-- a fresh install creates Roles.IsSuperAdmin as a nullable flag; make it NOT NULL like an upgraded database
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.Roles') AND name = N'IsSuperAdmin' AND is_nullable = 1)
BEGIN
    UPDATE dbo.Roles SET IsSuperAdmin = 0 WHERE IsSuperAdmin IS NULL;
    ALTER TABLE dbo.Roles ALTER COLUMN IsSuperAdmin BIT NOT NULL;
END
GO

-- ---------- 1c. Who created / changed each record: CreatedBy, CreatedAt, UpdatedBy, UpdatedAt on every user-maintained table ----------
IF COL_LENGTH('dbo.Locations', 'CreatedBy') IS NULL ALTER TABLE dbo.Locations ADD CreatedBy INT NULL;
IF COL_LENGTH('dbo.Locations', 'CreatedAt') IS NULL ALTER TABLE dbo.Locations ADD CreatedAt DATETIME NULL CONSTRAINT DF_Locations_CreatedAt DEFAULT GETDATE();
IF COL_LENGTH('dbo.Locations', 'UpdatedBy') IS NULL ALTER TABLE dbo.Locations ADD UpdatedBy INT NULL;
IF COL_LENGTH('dbo.Locations', 'UpdatedAt') IS NULL ALTER TABLE dbo.Locations ADD UpdatedAt DATETIME NULL;
IF COL_LENGTH('dbo.Temples', 'CreatedBy') IS NULL ALTER TABLE dbo.Temples ADD CreatedBy INT NULL;
IF COL_LENGTH('dbo.Temples', 'CreatedAt') IS NULL ALTER TABLE dbo.Temples ADD CreatedAt DATETIME NULL CONSTRAINT DF_Temples_CreatedAt DEFAULT GETDATE();
IF COL_LENGTH('dbo.Temples', 'UpdatedBy') IS NULL ALTER TABLE dbo.Temples ADD UpdatedBy INT NULL;
IF COL_LENGTH('dbo.Temples', 'UpdatedAt') IS NULL ALTER TABLE dbo.Temples ADD UpdatedAt DATETIME NULL;
IF COL_LENGTH('dbo.Deities', 'CreatedBy') IS NULL ALTER TABLE dbo.Deities ADD CreatedBy INT NULL;
IF COL_LENGTH('dbo.Deities', 'CreatedAt') IS NULL ALTER TABLE dbo.Deities ADD CreatedAt DATETIME NULL CONSTRAINT DF_Deities_CreatedAt DEFAULT GETDATE();
IF COL_LENGTH('dbo.Deities', 'UpdatedBy') IS NULL ALTER TABLE dbo.Deities ADD UpdatedBy INT NULL;
IF COL_LENGTH('dbo.Deities', 'UpdatedAt') IS NULL ALTER TABLE dbo.Deities ADD UpdatedAt DATETIME NULL;
IF COL_LENGTH('dbo.SevaCategories', 'CreatedBy') IS NULL ALTER TABLE dbo.SevaCategories ADD CreatedBy INT NULL;
IF COL_LENGTH('dbo.SevaCategories', 'CreatedAt') IS NULL ALTER TABLE dbo.SevaCategories ADD CreatedAt DATETIME NULL CONSTRAINT DF_SevaCategories_CreatedAt DEFAULT GETDATE();
IF COL_LENGTH('dbo.SevaCategories', 'UpdatedBy') IS NULL ALTER TABLE dbo.SevaCategories ADD UpdatedBy INT NULL;
IF COL_LENGTH('dbo.SevaCategories', 'UpdatedAt') IS NULL ALTER TABLE dbo.SevaCategories ADD UpdatedAt DATETIME NULL;
IF COL_LENGTH('dbo.SevaMaster', 'CreatedBy') IS NULL ALTER TABLE dbo.SevaMaster ADD CreatedBy INT NULL;
IF COL_LENGTH('dbo.SevaMaster', 'CreatedAt') IS NULL ALTER TABLE dbo.SevaMaster ADD CreatedAt DATETIME NULL CONSTRAINT DF_SevaMaster_CreatedAt DEFAULT GETDATE();
IF COL_LENGTH('dbo.SevaMaster', 'UpdatedBy') IS NULL ALTER TABLE dbo.SevaMaster ADD UpdatedBy INT NULL;
IF COL_LENGTH('dbo.SevaMaster', 'UpdatedAt') IS NULL ALTER TABLE dbo.SevaMaster ADD UpdatedAt DATETIME NULL;
IF COL_LENGTH('dbo.ItemMaster', 'CreatedBy') IS NULL ALTER TABLE dbo.ItemMaster ADD CreatedBy INT NULL;
IF COL_LENGTH('dbo.ItemMaster', 'CreatedAt') IS NULL ALTER TABLE dbo.ItemMaster ADD CreatedAt DATETIME NULL CONSTRAINT DF_ItemMaster_CreatedAt DEFAULT GETDATE();
IF COL_LENGTH('dbo.ItemMaster', 'UpdatedBy') IS NULL ALTER TABLE dbo.ItemMaster ADD UpdatedBy INT NULL;
IF COL_LENGTH('dbo.ItemMaster', 'UpdatedAt') IS NULL ALTER TABLE dbo.ItemMaster ADD UpdatedAt DATETIME NULL;
IF COL_LENGTH('dbo.Counters', 'CreatedBy') IS NULL ALTER TABLE dbo.Counters ADD CreatedBy INT NULL;
IF COL_LENGTH('dbo.Counters', 'CreatedAt') IS NULL ALTER TABLE dbo.Counters ADD CreatedAt DATETIME NULL CONSTRAINT DF_Counters_CreatedAt DEFAULT GETDATE();
IF COL_LENGTH('dbo.Counters', 'UpdatedBy') IS NULL ALTER TABLE dbo.Counters ADD UpdatedBy INT NULL;
IF COL_LENGTH('dbo.Counters', 'UpdatedAt') IS NULL ALTER TABLE dbo.Counters ADD UpdatedAt DATETIME NULL;
IF COL_LENGTH('dbo.SevaTimeSlots', 'CreatedBy') IS NULL ALTER TABLE dbo.SevaTimeSlots ADD CreatedBy INT NULL;
IF COL_LENGTH('dbo.SevaTimeSlots', 'CreatedAt') IS NULL ALTER TABLE dbo.SevaTimeSlots ADD CreatedAt DATETIME NULL CONSTRAINT DF_SevaTimeSlots_CreatedAt DEFAULT GETDATE();
IF COL_LENGTH('dbo.SevaTimeSlots', 'UpdatedBy') IS NULL ALTER TABLE dbo.SevaTimeSlots ADD UpdatedBy INT NULL;
IF COL_LENGTH('dbo.SevaTimeSlots', 'UpdatedAt') IS NULL ALTER TABLE dbo.SevaTimeSlots ADD UpdatedAt DATETIME NULL;
IF COL_LENGTH('dbo.BookingTypes', 'CreatedBy') IS NULL ALTER TABLE dbo.BookingTypes ADD CreatedBy INT NULL;
IF COL_LENGTH('dbo.BookingTypes', 'CreatedAt') IS NULL ALTER TABLE dbo.BookingTypes ADD CreatedAt DATETIME NULL CONSTRAINT DF_BookingTypes_CreatedAt DEFAULT GETDATE();
IF COL_LENGTH('dbo.BookingTypes', 'UpdatedBy') IS NULL ALTER TABLE dbo.BookingTypes ADD UpdatedBy INT NULL;
IF COL_LENGTH('dbo.BookingTypes', 'UpdatedAt') IS NULL ALTER TABLE dbo.BookingTypes ADD UpdatedAt DATETIME NULL;
IF COL_LENGTH('dbo.PaymentModes', 'CreatedBy') IS NULL ALTER TABLE dbo.PaymentModes ADD CreatedBy INT NULL;
IF COL_LENGTH('dbo.PaymentModes', 'CreatedAt') IS NULL ALTER TABLE dbo.PaymentModes ADD CreatedAt DATETIME NULL CONSTRAINT DF_PaymentModes_CreatedAt DEFAULT GETDATE();
IF COL_LENGTH('dbo.PaymentModes', 'UpdatedBy') IS NULL ALTER TABLE dbo.PaymentModes ADD UpdatedBy INT NULL;
IF COL_LENGTH('dbo.PaymentModes', 'UpdatedAt') IS NULL ALTER TABLE dbo.PaymentModes ADD UpdatedAt DATETIME NULL;
IF COL_LENGTH('dbo.BookingStatuses', 'CreatedBy') IS NULL ALTER TABLE dbo.BookingStatuses ADD CreatedBy INT NULL;
IF COL_LENGTH('dbo.BookingStatuses', 'CreatedAt') IS NULL ALTER TABLE dbo.BookingStatuses ADD CreatedAt DATETIME NULL CONSTRAINT DF_BookingStatuses_CreatedAt DEFAULT GETDATE();
IF COL_LENGTH('dbo.BookingStatuses', 'UpdatedBy') IS NULL ALTER TABLE dbo.BookingStatuses ADD UpdatedBy INT NULL;
IF COL_LENGTH('dbo.BookingStatuses', 'UpdatedAt') IS NULL ALTER TABLE dbo.BookingStatuses ADD UpdatedAt DATETIME NULL;
IF COL_LENGTH('dbo.MemberFrequencies', 'CreatedBy') IS NULL ALTER TABLE dbo.MemberFrequencies ADD CreatedBy INT NULL;
IF COL_LENGTH('dbo.MemberFrequencies', 'CreatedAt') IS NULL ALTER TABLE dbo.MemberFrequencies ADD CreatedAt DATETIME NULL CONSTRAINT DF_MemberFrequencies_CreatedAt DEFAULT GETDATE();
IF COL_LENGTH('dbo.MemberFrequencies', 'UpdatedBy') IS NULL ALTER TABLE dbo.MemberFrequencies ADD UpdatedBy INT NULL;
IF COL_LENGTH('dbo.MemberFrequencies', 'UpdatedAt') IS NULL ALTER TABLE dbo.MemberFrequencies ADD UpdatedAt DATETIME NULL;
IF COL_LENGTH('dbo.MemberStatuses', 'CreatedBy') IS NULL ALTER TABLE dbo.MemberStatuses ADD CreatedBy INT NULL;
IF COL_LENGTH('dbo.MemberStatuses', 'CreatedAt') IS NULL ALTER TABLE dbo.MemberStatuses ADD CreatedAt DATETIME NULL CONSTRAINT DF_MemberStatuses_CreatedAt DEFAULT GETDATE();
IF COL_LENGTH('dbo.MemberStatuses', 'UpdatedBy') IS NULL ALTER TABLE dbo.MemberStatuses ADD UpdatedBy INT NULL;
IF COL_LENGTH('dbo.MemberStatuses', 'UpdatedAt') IS NULL ALTER TABLE dbo.MemberStatuses ADD UpdatedAt DATETIME NULL;
IF COL_LENGTH('dbo.Roles', 'CreatedBy') IS NULL ALTER TABLE dbo.Roles ADD CreatedBy INT NULL;
IF COL_LENGTH('dbo.Roles', 'CreatedAt') IS NULL ALTER TABLE dbo.Roles ADD CreatedAt DATETIME NULL CONSTRAINT DF_Roles_CreatedAt DEFAULT GETDATE();
IF COL_LENGTH('dbo.Roles', 'UpdatedBy') IS NULL ALTER TABLE dbo.Roles ADD UpdatedBy INT NULL;
IF COL_LENGTH('dbo.Roles', 'UpdatedAt') IS NULL ALTER TABLE dbo.Roles ADD UpdatedAt DATETIME NULL;
IF COL_LENGTH('dbo.Screens', 'CreatedBy') IS NULL ALTER TABLE dbo.Screens ADD CreatedBy INT NULL;
IF COL_LENGTH('dbo.Screens', 'CreatedAt') IS NULL ALTER TABLE dbo.Screens ADD CreatedAt DATETIME NULL CONSTRAINT DF_Screens_CreatedAt DEFAULT GETDATE();
IF COL_LENGTH('dbo.Screens', 'UpdatedBy') IS NULL ALTER TABLE dbo.Screens ADD UpdatedBy INT NULL;
IF COL_LENGTH('dbo.Screens', 'UpdatedAt') IS NULL ALTER TABLE dbo.Screens ADD UpdatedAt DATETIME NULL;
IF COL_LENGTH('dbo.ScreenPermissions', 'CreatedBy') IS NULL ALTER TABLE dbo.ScreenPermissions ADD CreatedBy INT NULL;
IF COL_LENGTH('dbo.ScreenPermissions', 'CreatedAt') IS NULL ALTER TABLE dbo.ScreenPermissions ADD CreatedAt DATETIME NULL CONSTRAINT DF_ScreenPermissions_CreatedAt DEFAULT GETDATE();
IF COL_LENGTH('dbo.ScreenPermissions', 'UpdatedBy') IS NULL ALTER TABLE dbo.ScreenPermissions ADD UpdatedBy INT NULL;
IF COL_LENGTH('dbo.ScreenPermissions', 'UpdatedAt') IS NULL ALTER TABLE dbo.ScreenPermissions ADD UpdatedAt DATETIME NULL;
IF COL_LENGTH('dbo.Users', 'CreatedBy') IS NULL ALTER TABLE dbo.Users ADD CreatedBy INT NULL;
IF COL_LENGTH('dbo.Users', 'CreatedAt') IS NULL ALTER TABLE dbo.Users ADD CreatedAt DATETIME NULL CONSTRAINT DF_Users_CreatedAt DEFAULT GETDATE();
IF COL_LENGTH('dbo.Users', 'UpdatedBy') IS NULL ALTER TABLE dbo.Users ADD UpdatedBy INT NULL;
IF COL_LENGTH('dbo.Users', 'UpdatedAt') IS NULL ALTER TABLE dbo.Users ADD UpdatedAt DATETIME NULL;
IF COL_LENGTH('dbo.LifetimeMembers', 'CreatedBy') IS NULL ALTER TABLE dbo.LifetimeMembers ADD CreatedBy INT NULL;
IF COL_LENGTH('dbo.LifetimeMembers', 'CreatedAt') IS NULL ALTER TABLE dbo.LifetimeMembers ADD CreatedAt DATETIME NULL CONSTRAINT DF_LifetimeMembers_CreatedAt DEFAULT GETDATE();
IF COL_LENGTH('dbo.LifetimeMembers', 'UpdatedBy') IS NULL ALTER TABLE dbo.LifetimeMembers ADD UpdatedBy INT NULL;
IF COL_LENGTH('dbo.LifetimeMembers', 'UpdatedAt') IS NULL ALTER TABLE dbo.LifetimeMembers ADD UpdatedAt DATETIME NULL;
IF COL_LENGTH('dbo.Bookings', 'CreatedBy') IS NULL ALTER TABLE dbo.Bookings ADD CreatedBy INT NULL;
IF COL_LENGTH('dbo.Bookings', 'CreatedAt') IS NULL ALTER TABLE dbo.Bookings ADD CreatedAt DATETIME NULL CONSTRAINT DF_Bookings_CreatedAt DEFAULT GETDATE();
IF COL_LENGTH('dbo.Bookings', 'UpdatedBy') IS NULL ALTER TABLE dbo.Bookings ADD UpdatedBy INT NULL;
IF COL_LENGTH('dbo.Bookings', 'UpdatedAt') IS NULL ALTER TABLE dbo.Bookings ADD UpdatedAt DATETIME NULL;
IF COL_LENGTH('dbo.AppSettings', 'CreatedBy') IS NULL ALTER TABLE dbo.AppSettings ADD CreatedBy INT NULL;
IF COL_LENGTH('dbo.AppSettings', 'CreatedAt') IS NULL ALTER TABLE dbo.AppSettings ADD CreatedAt DATETIME NULL CONSTRAINT DF_AppSettings_CreatedAt DEFAULT GETDATE();
IF COL_LENGTH('dbo.AppSettings', 'UpdatedBy') IS NULL ALTER TABLE dbo.AppSettings ADD UpdatedBy INT NULL;
IF COL_LENGTH('dbo.AppSettings', 'UpdatedAt') IS NULL ALTER TABLE dbo.AppSettings ADD UpdatedAt DATETIME NULL;
IF COL_LENGTH('dbo.BookingItems', 'CreatedBy') IS NULL ALTER TABLE dbo.BookingItems ADD CreatedBy INT NULL;
IF COL_LENGTH('dbo.BookingItems', 'CreatedAt') IS NULL ALTER TABLE dbo.BookingItems ADD CreatedAt DATETIME NULL CONSTRAINT DF_BookingItems_CreatedAt DEFAULT GETDATE();
IF COL_LENGTH('dbo.UserLocations', 'CreatedBy') IS NULL ALTER TABLE dbo.UserLocations ADD CreatedBy INT NULL;
IF COL_LENGTH('dbo.UserLocations', 'CreatedAt') IS NULL ALTER TABLE dbo.UserLocations ADD CreatedAt DATETIME NULL CONSTRAINT DF_UserLocations_CreatedAt DEFAULT GETDATE();
GO

-- every CreatedBy / UpdatedBy points at a real user (added once; existing foreign keys are kept)
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.Locations') AND col.name = N'CreatedBy')
    EXEC(N'ALTER TABLE dbo.Locations ADD CONSTRAINT FK_Locations_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.Locations') AND col.name = N'UpdatedBy')
    EXEC(N'ALTER TABLE dbo.Locations ADD CONSTRAINT FK_Locations_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.Temples') AND col.name = N'CreatedBy')
    EXEC(N'ALTER TABLE dbo.Temples ADD CONSTRAINT FK_Temples_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.Temples') AND col.name = N'UpdatedBy')
    EXEC(N'ALTER TABLE dbo.Temples ADD CONSTRAINT FK_Temples_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.Deities') AND col.name = N'CreatedBy')
    EXEC(N'ALTER TABLE dbo.Deities ADD CONSTRAINT FK_Deities_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.Deities') AND col.name = N'UpdatedBy')
    EXEC(N'ALTER TABLE dbo.Deities ADD CONSTRAINT FK_Deities_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.SevaCategories') AND col.name = N'CreatedBy')
    EXEC(N'ALTER TABLE dbo.SevaCategories ADD CONSTRAINT FK_SevaCategories_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.SevaCategories') AND col.name = N'UpdatedBy')
    EXEC(N'ALTER TABLE dbo.SevaCategories ADD CONSTRAINT FK_SevaCategories_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.SevaMaster') AND col.name = N'CreatedBy')
    EXEC(N'ALTER TABLE dbo.SevaMaster ADD CONSTRAINT FK_SevaMaster_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.SevaMaster') AND col.name = N'UpdatedBy')
    EXEC(N'ALTER TABLE dbo.SevaMaster ADD CONSTRAINT FK_SevaMaster_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.ItemMaster') AND col.name = N'CreatedBy')
    EXEC(N'ALTER TABLE dbo.ItemMaster ADD CONSTRAINT FK_ItemMaster_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.ItemMaster') AND col.name = N'UpdatedBy')
    EXEC(N'ALTER TABLE dbo.ItemMaster ADD CONSTRAINT FK_ItemMaster_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.Counters') AND col.name = N'CreatedBy')
    EXEC(N'ALTER TABLE dbo.Counters ADD CONSTRAINT FK_Counters_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.Counters') AND col.name = N'UpdatedBy')
    EXEC(N'ALTER TABLE dbo.Counters ADD CONSTRAINT FK_Counters_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.SevaTimeSlots') AND col.name = N'CreatedBy')
    EXEC(N'ALTER TABLE dbo.SevaTimeSlots ADD CONSTRAINT FK_SevaTimeSlots_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.SevaTimeSlots') AND col.name = N'UpdatedBy')
    EXEC(N'ALTER TABLE dbo.SevaTimeSlots ADD CONSTRAINT FK_SevaTimeSlots_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.BookingTypes') AND col.name = N'CreatedBy')
    EXEC(N'ALTER TABLE dbo.BookingTypes ADD CONSTRAINT FK_BookingTypes_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.BookingTypes') AND col.name = N'UpdatedBy')
    EXEC(N'ALTER TABLE dbo.BookingTypes ADD CONSTRAINT FK_BookingTypes_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.PaymentModes') AND col.name = N'CreatedBy')
    EXEC(N'ALTER TABLE dbo.PaymentModes ADD CONSTRAINT FK_PaymentModes_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.PaymentModes') AND col.name = N'UpdatedBy')
    EXEC(N'ALTER TABLE dbo.PaymentModes ADD CONSTRAINT FK_PaymentModes_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.BookingStatuses') AND col.name = N'CreatedBy')
    EXEC(N'ALTER TABLE dbo.BookingStatuses ADD CONSTRAINT FK_BookingStatuses_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.BookingStatuses') AND col.name = N'UpdatedBy')
    EXEC(N'ALTER TABLE dbo.BookingStatuses ADD CONSTRAINT FK_BookingStatuses_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.MemberFrequencies') AND col.name = N'CreatedBy')
    EXEC(N'ALTER TABLE dbo.MemberFrequencies ADD CONSTRAINT FK_MemberFrequencies_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.MemberFrequencies') AND col.name = N'UpdatedBy')
    EXEC(N'ALTER TABLE dbo.MemberFrequencies ADD CONSTRAINT FK_MemberFrequencies_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.MemberStatuses') AND col.name = N'CreatedBy')
    EXEC(N'ALTER TABLE dbo.MemberStatuses ADD CONSTRAINT FK_MemberStatuses_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.MemberStatuses') AND col.name = N'UpdatedBy')
    EXEC(N'ALTER TABLE dbo.MemberStatuses ADD CONSTRAINT FK_MemberStatuses_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.Roles') AND col.name = N'CreatedBy')
    EXEC(N'ALTER TABLE dbo.Roles ADD CONSTRAINT FK_Roles_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.Roles') AND col.name = N'UpdatedBy')
    EXEC(N'ALTER TABLE dbo.Roles ADD CONSTRAINT FK_Roles_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.Screens') AND col.name = N'CreatedBy')
    EXEC(N'ALTER TABLE dbo.Screens ADD CONSTRAINT FK_Screens_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.Screens') AND col.name = N'UpdatedBy')
    EXEC(N'ALTER TABLE dbo.Screens ADD CONSTRAINT FK_Screens_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.ScreenPermissions') AND col.name = N'CreatedBy')
    EXEC(N'ALTER TABLE dbo.ScreenPermissions ADD CONSTRAINT FK_ScreenPermissions_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.ScreenPermissions') AND col.name = N'UpdatedBy')
    EXEC(N'ALTER TABLE dbo.ScreenPermissions ADD CONSTRAINT FK_ScreenPermissions_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.Users') AND col.name = N'CreatedBy')
    EXEC(N'ALTER TABLE dbo.Users ADD CONSTRAINT FK_Users_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.Users') AND col.name = N'UpdatedBy')
    EXEC(N'ALTER TABLE dbo.Users ADD CONSTRAINT FK_Users_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.LifetimeMembers') AND col.name = N'CreatedBy')
    EXEC(N'ALTER TABLE dbo.LifetimeMembers ADD CONSTRAINT FK_LifetimeMembers_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.LifetimeMembers') AND col.name = N'UpdatedBy')
    EXEC(N'ALTER TABLE dbo.LifetimeMembers ADD CONSTRAINT FK_LifetimeMembers_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.Bookings') AND col.name = N'CreatedBy')
    EXEC(N'ALTER TABLE dbo.Bookings ADD CONSTRAINT FK_Bookings_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.Bookings') AND col.name = N'UpdatedBy')
    EXEC(N'ALTER TABLE dbo.Bookings ADD CONSTRAINT FK_Bookings_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.AppSettings') AND col.name = N'CreatedBy')
    EXEC(N'ALTER TABLE dbo.AppSettings ADD CONSTRAINT FK_AppSettings_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.AppSettings') AND col.name = N'UpdatedBy')
    EXEC(N'ALTER TABLE dbo.AppSettings ADD CONSTRAINT FK_AppSettings_UpdatedBy FOREIGN KEY (UpdatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.BookingItems') AND col.name = N'CreatedBy')
    EXEC(N'ALTER TABLE dbo.BookingItems ADD CONSTRAINT FK_BookingItems_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId)');
IF NOT EXISTS (SELECT 1 FROM sys.foreign_key_columns fc JOIN sys.columns col ON col.object_id = fc.parent_object_id AND col.column_id = fc.parent_column_id
           WHERE fc.parent_object_id = OBJECT_ID(N'dbo.UserLocations') AND col.name = N'CreatedBy')
    EXEC(N'ALTER TABLE dbo.UserLocations ADD CONSTRAINT FK_UserLocations_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users(UserId)');
GO

-- ---------- 2. App settings (name, number prefixes, currency, locale, time zone, validation) ----------
IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE SettingKey = N'appName') INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES (N'appName', N'Temple Seva Booking System');
IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE SettingKey = N'tagline') INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES (N'tagline', N'Seva booking & temple administration');
IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE SettingKey = N'bookingNumberPrefix') INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES (N'bookingNumberPrefix', N'BK');
IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE SettingKey = N'memberNumberPrefix') INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES (N'memberNumberPrefix', N'MEM');
IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE SettingKey = N'fallbackTokenPrefix') INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES (N'fallbackTokenPrefix', N'TK');
IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE SettingKey = N'currencySymbol') INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES (N'currencySymbol', NCHAR(8377));
IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE SettingKey = N'locale') INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES (N'locale', N'en-IN');
IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE SettingKey = N'timeZone') INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES (N'timeZone', N'Asia/Kolkata');
IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE SettingKey = N'sessionExpiry') INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES (N'sessionExpiry', N'12h');
IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE SettingKey = N'mobilePattern') INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES (N'mobilePattern', N'^\d{10}$');
IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE SettingKey = N'maxQuantity') INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES (N'maxQuantity', N'99');
IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE SettingKey = N'financialYearStartMonth') INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES (N'financialYearStartMonth', N'4');
IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE SettingKey = N'bookingNumberFormat') INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES (N'bookingNumberFormat', N'{PREFIX}-{FY}-{SEQ6}');
IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE SettingKey = N'tokenNumberFormat') INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES (N'tokenNumberFormat', N'{PREFIX}-{FY}-{SEQ5}');
IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE SettingKey = N'memberNumberFormat') INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES (N'memberNumberFormat', N'{PREFIX}-{FY}-{SEQ5}');
IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE SettingKey = N'upiMaxAmount') INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES (N'upiMaxAmount', N'100000');
IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE SettingKey = N'defaultPageSize') INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES (N'defaultPageSize', N'25');
IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE SettingKey = N'pageSizeOptions') INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES (N'pageSizeOptions', N'10,25,50,100');
IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE SettingKey = N'upiIncludeTxnRef') INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES (N'upiIncludeTxnRef', N'false');
IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE SettingKey = N'brandName') INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES (N'brandName', N'RetailCliQ');
IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE SettingKey = N'brandLogoUrl') INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES (N'brandLogoUrl', N'/brand/logo.png');
IF NOT EXISTS (SELECT 1 FROM dbo.AppSettings WHERE SettingKey = N'brandIconUrl') INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES (N'brandIconUrl', N'/brand/icon.png');
GO

-- ---------- 3. Locations (login picker, header branding, receipts) ----------
IF NOT EXISTS (SELECT 1 FROM dbo.Locations)
    INSERT INTO dbo.Locations (LocationName, LocationCode, Description, Address, Phone, Email, ReceiptFooter, UpiVpa, UpiPayeeName, IsActive, DisplayOrder) VALUES
    (N'Uttara Tirupati', N'UTP', (N'Uttara Tirupati Kshetram ' + NCHAR(8212) + N' main pilgrimage complex'), N'Uttara Tirupati, Hyderabad, Telangana', N'+91 40 2345 6789', N'uttaratirupati@example.org', (N'Om Namo Venkatesaya ' + NCHAR(8212) + N' may the blessings of Lord Venkateswara be with you.'), N'', N'', 1, 1),
    (N'Tirupati Balaji', N'TPT', N'Sri Venkateswara Swamy Temple, Tirupati', N'Tirumala, Tirupati, Andhra Pradesh', N'+91 877 227 7777', N'tirupati@example.org', (N'Govinda Govinda ' + NCHAR(8212) + N' thank you for your offering.'), N'', N'', 1, 2),
    (N'Srisailam', N'SSM', N'Sri Mallikarjuna Swamy Temple, Srisailam', N'Srisailam, Nandyal, Andhra Pradesh', N'+91 8524 288 888', N'srisailam@example.org', (N'Om Namah Shivaya ' + NCHAR(8212) + N' may Lord Mallikarjuna bless you.'), N'', N'', 1, 3);
-- locations from v2/v3: fill in the new details once
UPDATE x SET LocationCode = v.LocationCode, Phone = v.Phone, Email = v.Email, ReceiptFooter = v.ReceiptFooter
FROM dbo.Locations x JOIN (VALUES
    (N'Uttara Tirupati', N'UTP', N'+91 40 2345 6789', N'uttaratirupati@example.org', (N'Om Namo Venkatesaya ' + NCHAR(8212) + N' may the blessings of Lord Venkateswara be with you.')),
    (N'Tirupati Balaji', N'TPT', N'+91 877 227 7777', N'tirupati@example.org', (N'Govinda Govinda ' + NCHAR(8212) + N' thank you for your offering.')),
    (N'Srisailam', N'SSM', N'+91 8524 288 888', N'srisailam@example.org', (N'Om Namah Shivaya ' + NCHAR(8212) + N' may Lord Mallikarjuna bless you.'))
) v (LocationName, LocationCode, Phone, Email, ReceiptFooter) ON v.LocationName = x.LocationName
WHERE x.LocationCode IS NULL;
-- rows from earlier versions without a location: temple's location, else the counter's, else the main (first) location
UPDATE dbo.Temples SET LocationId = (SELECT TOP 1 LocationId FROM dbo.Locations ORDER BY DisplayOrder, LocationId) WHERE LocationId IS NULL;
UPDATE dbo.Counters SET LocationId = (SELECT TOP 1 LocationId FROM dbo.Locations ORDER BY DisplayOrder, LocationId) WHERE LocationId IS NULL;
UPDATE s SET LocationId = t.LocationId FROM dbo.SevaTimeSlots s JOIN dbo.Temples t ON t.TempleId = s.TempleId WHERE s.LocationId IS NULL;
UPDATE m SET LocationId = t.LocationId FROM dbo.LifetimeMembers m JOIN dbo.Temples t ON t.TempleId = m.TempleId WHERE m.LocationId IS NULL;
UPDATE dbo.LifetimeMembers SET LocationId = (SELECT TOP 1 LocationId FROM dbo.Locations ORDER BY DisplayOrder, LocationId) WHERE LocationId IS NULL;
UPDATE b SET LocationId = t.LocationId FROM dbo.Bookings b JOIN dbo.Temples t ON t.TempleId = b.TempleId WHERE b.LocationId IS NULL;
UPDATE b SET LocationId = c.LocationId FROM dbo.Bookings b JOIN dbo.Counters c ON c.CounterId = b.CounterId WHERE b.LocationId IS NULL;
UPDATE dbo.Bookings SET LocationId = (SELECT TOP 1 LocationId FROM dbo.Locations ORDER BY DisplayOrder, LocationId) WHERE LocationId IS NULL;
GO

-- ---------- 4. Temples per location, deities per temple, seva categories, temple-wise sevas & prices ----------
INSERT INTO dbo.Temples (LocationId, TempleName, Description, Address, IsMainTemple, IsActive, DisplayOrder)
SELECT l.LocationId, v.TempleName, v.Description, v.Address, v.IsMainTemple, v.IsActive, v.DisplayOrder
FROM dbo.Locations l CROSS JOIN (VALUES
    (N'Venkateshwara Swami', N'Main temple - Sri Venkateshwara Swami Temple', N'', 1, 1, 1),
    (N'General', N'General temple services and common sevas', N'', 0, 1, 2),
    (N'Dattatreya Swami', N'Sri Dattatreya Swami Temple', N'', 0, 1, 3),
    (N'Anjaneya Swami', N'Sri Anjaneya Swami Temple', N'', 0, 1, 4),
    (N'Padmavathi Ammavaru', N'Sri Padmavathi Ammavaru Temple', N'', 0, 1, 5),
    (N'Lord Shiva', N'Lord Shiva Temple', N'', 0, 1, 6),
    (N'Ganapathi', N'Sri Ganapathi Temple', N'', 0, 1, 7)
) v (TempleName, Description, Address, IsMainTemple, IsActive, DisplayOrder)
WHERE l.LocationName = N'Uttara Tirupati' AND NOT EXISTS (SELECT 1 FROM dbo.Temples x WHERE x.LocationId = l.LocationId);
INSERT INTO dbo.Temples (LocationId, TempleName, Description, Address, IsMainTemple, IsActive, DisplayOrder)
SELECT l.LocationId, v.TempleName, v.Description, v.Address, v.IsMainTemple, v.IsActive, v.DisplayOrder
FROM dbo.Locations l CROSS JOIN (VALUES
    (N'Sri Venkateswara Swamy', N'Tirumala Balaji Temple', N'Tirumala', 1, 1, 1)
) v (TempleName, Description, Address, IsMainTemple, IsActive, DisplayOrder)
WHERE l.LocationName = N'Tirupati Balaji' AND NOT EXISTS (SELECT 1 FROM dbo.Temples x WHERE x.LocationId = l.LocationId);
INSERT INTO dbo.Temples (LocationId, TempleName, Description, Address, IsMainTemple, IsActive, DisplayOrder)
SELECT l.LocationId, v.TempleName, v.Description, v.Address, v.IsMainTemple, v.IsActive, v.DisplayOrder
FROM dbo.Locations l CROSS JOIN (VALUES
    (N'Sri Mallikarjuna Swamy', N'Srisailam Mallikarjuna Temple', N'Srisailam', 1, 1, 1)
) v (TempleName, Description, Address, IsMainTemple, IsActive, DisplayOrder)
WHERE l.LocationName = N'Srisailam' AND NOT EXISTS (SELECT 1 FROM dbo.Temples x WHERE x.LocationId = l.LocationId);
INSERT INTO dbo.Deities (TempleId, DeityName, Description, IsMainDeity, IsActive, DisplayOrder)
SELECT t.TempleId, v.DeityName, v.Description, v.IsMainDeity, v.IsActive, v.DisplayOrder
FROM dbo.Temples t JOIN dbo.Locations l ON l.LocationId = t.LocationId AND l.LocationName = N'Uttara Tirupati' CROSS JOIN (VALUES
    (N'Sri Venkateshwara Swami', N'Main deity of Venkateshwara Swami Temple', 1, 1, 1)
) v (DeityName, Description, IsMainDeity, IsActive, DisplayOrder)
WHERE t.TempleName = N'Venkateshwara Swami' AND NOT EXISTS (SELECT 1 FROM dbo.Deities x WHERE x.TempleId = t.TempleId);
INSERT INTO dbo.Deities (TempleId, DeityName, Description, IsMainDeity, IsActive, DisplayOrder)
SELECT t.TempleId, v.DeityName, v.Description, v.IsMainDeity, v.IsActive, v.DisplayOrder
FROM dbo.Temples t JOIN dbo.Locations l ON l.LocationId = t.LocationId AND l.LocationName = N'Uttara Tirupati' CROSS JOIN (VALUES
    (N'General Deity', N'Main deity of General Temple', 1, 1, 1)
) v (DeityName, Description, IsMainDeity, IsActive, DisplayOrder)
WHERE t.TempleName = N'General' AND NOT EXISTS (SELECT 1 FROM dbo.Deities x WHERE x.TempleId = t.TempleId);
INSERT INTO dbo.Deities (TempleId, DeityName, Description, IsMainDeity, IsActive, DisplayOrder)
SELECT t.TempleId, v.DeityName, v.Description, v.IsMainDeity, v.IsActive, v.DisplayOrder
FROM dbo.Temples t JOIN dbo.Locations l ON l.LocationId = t.LocationId AND l.LocationName = N'Uttara Tirupati' CROSS JOIN (VALUES
    (N'Sri Dattatreya Swami', N'Main deity of Dattatreya Swami Temple', 1, 1, 1)
) v (DeityName, Description, IsMainDeity, IsActive, DisplayOrder)
WHERE t.TempleName = N'Dattatreya Swami' AND NOT EXISTS (SELECT 1 FROM dbo.Deities x WHERE x.TempleId = t.TempleId);
INSERT INTO dbo.Deities (TempleId, DeityName, Description, IsMainDeity, IsActive, DisplayOrder)
SELECT t.TempleId, v.DeityName, v.Description, v.IsMainDeity, v.IsActive, v.DisplayOrder
FROM dbo.Temples t JOIN dbo.Locations l ON l.LocationId = t.LocationId AND l.LocationName = N'Uttara Tirupati' CROSS JOIN (VALUES
    (N'Sri Anjaneya Swami', N'Main deity of Anjaneya Swami Temple', 1, 1, 1)
) v (DeityName, Description, IsMainDeity, IsActive, DisplayOrder)
WHERE t.TempleName = N'Anjaneya Swami' AND NOT EXISTS (SELECT 1 FROM dbo.Deities x WHERE x.TempleId = t.TempleId);
INSERT INTO dbo.Deities (TempleId, DeityName, Description, IsMainDeity, IsActive, DisplayOrder)
SELECT t.TempleId, v.DeityName, v.Description, v.IsMainDeity, v.IsActive, v.DisplayOrder
FROM dbo.Temples t JOIN dbo.Locations l ON l.LocationId = t.LocationId AND l.LocationName = N'Uttara Tirupati' CROSS JOIN (VALUES
    (N'Sri Padmavathi Ammavaru', N'Main deity of Padmavathi Ammavaru Temple', 1, 1, 1)
) v (DeityName, Description, IsMainDeity, IsActive, DisplayOrder)
WHERE t.TempleName = N'Padmavathi Ammavaru' AND NOT EXISTS (SELECT 1 FROM dbo.Deities x WHERE x.TempleId = t.TempleId);
INSERT INTO dbo.Deities (TempleId, DeityName, Description, IsMainDeity, IsActive, DisplayOrder)
SELECT t.TempleId, v.DeityName, v.Description, v.IsMainDeity, v.IsActive, v.DisplayOrder
FROM dbo.Temples t JOIN dbo.Locations l ON l.LocationId = t.LocationId AND l.LocationName = N'Uttara Tirupati' CROSS JOIN (VALUES
    (N'Lord Shiva', N'Main deity of Lord Shiva Temple', 1, 1, 1)
) v (DeityName, Description, IsMainDeity, IsActive, DisplayOrder)
WHERE t.TempleName = N'Lord Shiva' AND NOT EXISTS (SELECT 1 FROM dbo.Deities x WHERE x.TempleId = t.TempleId);
INSERT INTO dbo.Deities (TempleId, DeityName, Description, IsMainDeity, IsActive, DisplayOrder)
SELECT t.TempleId, v.DeityName, v.Description, v.IsMainDeity, v.IsActive, v.DisplayOrder
FROM dbo.Temples t JOIN dbo.Locations l ON l.LocationId = t.LocationId AND l.LocationName = N'Uttara Tirupati' CROSS JOIN (VALUES
    (N'Sri Ganapathi', N'Main deity of Ganapathi Temple', 1, 1, 1)
) v (DeityName, Description, IsMainDeity, IsActive, DisplayOrder)
WHERE t.TempleName = N'Ganapathi' AND NOT EXISTS (SELECT 1 FROM dbo.Deities x WHERE x.TempleId = t.TempleId);
INSERT INTO dbo.Deities (TempleId, DeityName, Description, IsMainDeity, IsActive, DisplayOrder)
SELECT t.TempleId, v.DeityName, v.Description, v.IsMainDeity, v.IsActive, v.DisplayOrder
FROM dbo.Temples t JOIN dbo.Locations l ON l.LocationId = t.LocationId AND l.LocationName = N'Tirupati Balaji' CROSS JOIN (VALUES
    (N'Sri Venkateswara Swamy', N'Main deity', 1, 1, 1)
) v (DeityName, Description, IsMainDeity, IsActive, DisplayOrder)
WHERE t.TempleName = N'Sri Venkateswara Swamy' AND NOT EXISTS (SELECT 1 FROM dbo.Deities x WHERE x.TempleId = t.TempleId);
INSERT INTO dbo.Deities (TempleId, DeityName, Description, IsMainDeity, IsActive, DisplayOrder)
SELECT t.TempleId, v.DeityName, v.Description, v.IsMainDeity, v.IsActive, v.DisplayOrder
FROM dbo.Temples t JOIN dbo.Locations l ON l.LocationId = t.LocationId AND l.LocationName = N'Srisailam' CROSS JOIN (VALUES
    (N'Sri Mallikarjuna Swamy', N'Main deity', 1, 1, 1)
) v (DeityName, Description, IsMainDeity, IsActive, DisplayOrder)
WHERE t.TempleName = N'Sri Mallikarjuna Swamy' AND NOT EXISTS (SELECT 1 FROM dbo.Deities x WHERE x.TempleId = t.TempleId);
IF NOT EXISTS (SELECT 1 FROM dbo.SevaCategories)
    INSERT INTO dbo.SevaCategories (CategoryName, IsActive, DisplayOrder) VALUES
    (N'Abhishekam', 1, 1),
    (N'Archana', 1, 2),
    (N'Alankara', 1, 3),
    (N'Kalyanam', 1, 4),
    (N'Homam', 1, 5),
    (N'Pooja', 1, 6),
    (N'Vratam', 1, 7),
    (N'Naivedya', 1, 8),
    (N'Seva', 1, 9),
    (N'Other', 1, 10);
INSERT INTO dbo.SevaMaster (TempleId, DeityId, CategoryId, SevaName, Amount, Description, IsActive)
SELECT t.TempleId, d.DeityId, c.CategoryId, v.SevaName, v.Amount, v.Description, v.IsActive
FROM dbo.Temples t JOIN dbo.Locations l ON l.LocationId = t.LocationId AND l.LocationName = N'Uttara Tirupati' CROSS JOIN (VALUES
    (N'Abhishekam Pradhana', N'Abhishekam', N'Sri Venkateshwara Swami', 2500, N'', 1),
    (N'Abhishekam Samisti', N'Abhishekam', N'Sri Venkateshwara Swami', 250, N'', 1),
    (N'Vastra Alankara Seva Pure Silk', N'Alankara', N'Sri Venkateshwara Swami', 42000, N'', 1),
    (N'Vastra Alankara Seva Cotton', N'Alankara', N'Sri Venkateshwara Swami', 800, N'', 1),
    (N'Naivedya Seva', N'Naivedya', N'Sri Venkateshwara Swami', 1100, N'', 1),
    (N'Pradhana Archana', N'Archana', N'Sri Venkateshwara Swami', 100, N'', 1),
    (N'Samisti Archana', N'Archana', N'Sri Venkateshwara Swami', 30, N'', 1),
    (N'Kalyanam Pradhana', N'Kalyanam', N'Sri Venkateshwara Swami', 5000, N'', 1),
    (N'Kalyanam Samisti', N'Kalyanam', N'Sri Venkateshwara Swami', 500, N'', 1),
    (N'Chandana Alankara Seva Pradhana', N'Alankara', N'Sri Venkateshwara Swami', 2500, N'', 1),
    (N'Ekanta Seva', N'Other', N'Sri Venkateshwara Swami', 100, N'', 1),
    (N'Sahasranama Archana', N'Archana', N'Sri Venkateshwara Swami', 1100, N'', 1)
) v (SevaName, CategoryName, DeityName, Amount, Description, IsActive)
JOIN dbo.SevaCategories c ON c.CategoryName = v.CategoryName
OUTER APPLY (SELECT TOP 1 dd.DeityId FROM dbo.Deities dd WHERE dd.TempleId = t.TempleId AND dd.DeityName = v.DeityName ORDER BY dd.DeityId) d
WHERE t.TempleName = N'Venkateshwara Swami' AND NOT EXISTS (SELECT 1 FROM dbo.SevaMaster x WHERE x.TempleId = t.TempleId);
INSERT INTO dbo.SevaMaster (TempleId, DeityId, CategoryId, SevaName, Amount, Description, IsActive)
SELECT t.TempleId, d.DeityId, c.CategoryId, v.SevaName, v.Amount, v.Description, v.IsActive
FROM dbo.Temples t JOIN dbo.Locations l ON l.LocationId = t.LocationId AND l.LocationName = N'Uttara Tirupati' CROSS JOIN (VALUES
    (N'Bhoovaraha Swami Abhishekam', N'Abhishekam', N'General Deity', 500, N'', 1),
    (N'Satyanarayana Swami Vratam Pradhana', N'Vratam', N'General Deity', 5000, N'', 1),
    (N'Satyanarayana Swami Vratam Samisti', N'Vratam', N'General Deity', 500, N'', 1),
    (N'Vahana Pooja 2 Wheeler', N'Pooja', N'General Deity', 500, N'', 1),
    (N'Vahana Pooja 4 Wheeler', N'Pooja', N'General Deity', 1000, N'', 1)
) v (SevaName, CategoryName, DeityName, Amount, Description, IsActive)
JOIN dbo.SevaCategories c ON c.CategoryName = v.CategoryName
OUTER APPLY (SELECT TOP 1 dd.DeityId FROM dbo.Deities dd WHERE dd.TempleId = t.TempleId AND dd.DeityName = v.DeityName ORDER BY dd.DeityId) d
WHERE t.TempleName = N'General' AND NOT EXISTS (SELECT 1 FROM dbo.SevaMaster x WHERE x.TempleId = t.TempleId);
INSERT INTO dbo.SevaMaster (TempleId, DeityId, CategoryId, SevaName, Amount, Description, IsActive)
SELECT t.TempleId, d.DeityId, c.CategoryId, v.SevaName, v.Amount, v.Description, v.IsActive
FROM dbo.Temples t JOIN dbo.Locations l ON l.LocationId = t.LocationId AND l.LocationName = N'Uttara Tirupati' CROSS JOIN (VALUES
    (N'Abhishekam Pradhana', N'Abhishekam', N'Sri Dattatreya Swami', 1100, N'', 1),
    (N'Anagha Vratam Pradhana', N'Vratam', N'Sri Dattatreya Swami', 1100, N'', 1),
    (N'Anagha Vratam Samisti', N'Vratam', N'Sri Dattatreya Swami', 150, N'', 1)
) v (SevaName, CategoryName, DeityName, Amount, Description, IsActive)
JOIN dbo.SevaCategories c ON c.CategoryName = v.CategoryName
OUTER APPLY (SELECT TOP 1 dd.DeityId FROM dbo.Deities dd WHERE dd.TempleId = t.TempleId AND dd.DeityName = v.DeityName ORDER BY dd.DeityId) d
WHERE t.TempleName = N'Dattatreya Swami' AND NOT EXISTS (SELECT 1 FROM dbo.SevaMaster x WHERE x.TempleId = t.TempleId);
INSERT INTO dbo.SevaMaster (TempleId, DeityId, CategoryId, SevaName, Amount, Description, IsActive)
SELECT t.TempleId, d.DeityId, c.CategoryId, v.SevaName, v.Amount, v.Description, v.IsActive
FROM dbo.Temples t JOIN dbo.Locations l ON l.LocationId = t.LocationId AND l.LocationName = N'Uttara Tirupati' CROSS JOIN (VALUES
    (N'Abhishekam Pradhana', N'Abhishekam', N'Sri Anjaneya Swami', 1100, N'', 1),
    (N'Vadamalasamarpa Seva', N'Seva', N'Sri Anjaneya Swami', 250, N'', 1)
) v (SevaName, CategoryName, DeityName, Amount, Description, IsActive)
JOIN dbo.SevaCategories c ON c.CategoryName = v.CategoryName
OUTER APPLY (SELECT TOP 1 dd.DeityId FROM dbo.Deities dd WHERE dd.TempleId = t.TempleId AND dd.DeityName = v.DeityName ORDER BY dd.DeityId) d
WHERE t.TempleName = N'Anjaneya Swami' AND NOT EXISTS (SELECT 1 FROM dbo.SevaMaster x WHERE x.TempleId = t.TempleId);
INSERT INTO dbo.SevaMaster (TempleId, DeityId, CategoryId, SevaName, Amount, Description, IsActive)
SELECT t.TempleId, d.DeityId, c.CategoryId, v.SevaName, v.Amount, v.Description, v.IsActive
FROM dbo.Temples t JOIN dbo.Locations l ON l.LocationId = t.LocationId AND l.LocationName = N'Uttara Tirupati' CROSS JOIN (VALUES
    (N'Abhishekam Seva Pradhana', N'Abhishekam', N'Sri Padmavathi Ammavaru', 1100, N'', 1),
    (N'Archana', N'Archana', N'Sri Padmavathi Ammavaru', 30, N'', 1),
    (N'Kumkumarchana', N'Archana', N'Sri Padmavathi Ammavaru', 100, N'', 1)
) v (SevaName, CategoryName, DeityName, Amount, Description, IsActive)
JOIN dbo.SevaCategories c ON c.CategoryName = v.CategoryName
OUTER APPLY (SELECT TOP 1 dd.DeityId FROM dbo.Deities dd WHERE dd.TempleId = t.TempleId AND dd.DeityName = v.DeityName ORDER BY dd.DeityId) d
WHERE t.TempleName = N'Padmavathi Ammavaru' AND NOT EXISTS (SELECT 1 FROM dbo.SevaMaster x WHERE x.TempleId = t.TempleId);
INSERT INTO dbo.SevaMaster (TempleId, DeityId, CategoryId, SevaName, Amount, Description, IsActive)
SELECT t.TempleId, d.DeityId, c.CategoryId, v.SevaName, v.Amount, v.Description, v.IsActive
FROM dbo.Temples t JOIN dbo.Locations l ON l.LocationId = t.LocationId AND l.LocationName = N'Uttara Tirupati' CROSS JOIN (VALUES
    (N'Rudhrabhisekam Pradhana', N'Abhishekam', N'Lord Shiva', 2500, N'', 1),
    (N'Shiva Parvathi Kalyanam Pradhana', N'Kalyanam', N'Lord Shiva', 5000, N'', 1)
) v (SevaName, CategoryName, DeityName, Amount, Description, IsActive)
JOIN dbo.SevaCategories c ON c.CategoryName = v.CategoryName
OUTER APPLY (SELECT TOP 1 dd.DeityId FROM dbo.Deities dd WHERE dd.TempleId = t.TempleId AND dd.DeityName = v.DeityName ORDER BY dd.DeityId) d
WHERE t.TempleName = N'Lord Shiva' AND NOT EXISTS (SELECT 1 FROM dbo.SevaMaster x WHERE x.TempleId = t.TempleId);
INSERT INTO dbo.SevaMaster (TempleId, DeityId, CategoryId, SevaName, Amount, Description, IsActive)
SELECT t.TempleId, d.DeityId, c.CategoryId, v.SevaName, v.Amount, v.Description, v.IsActive
FROM dbo.Temples t JOIN dbo.Locations l ON l.LocationId = t.LocationId AND l.LocationName = N'Uttara Tirupati' CROSS JOIN (VALUES
    (N'Abhishekam Pradhana', N'Abhishekam', N'Sri Ganapathi', 1100, N'', 1),
    (N'Sankashtachaturthi Pradhana', N'Pooja', N'Sri Ganapathi', 1100, N'', 1),
    (N'Homam Pradhana', N'Homam', N'Sri Ganapathi', 1100, N'', 1)
) v (SevaName, CategoryName, DeityName, Amount, Description, IsActive)
JOIN dbo.SevaCategories c ON c.CategoryName = v.CategoryName
OUTER APPLY (SELECT TOP 1 dd.DeityId FROM dbo.Deities dd WHERE dd.TempleId = t.TempleId AND dd.DeityName = v.DeityName ORDER BY dd.DeityId) d
WHERE t.TempleName = N'Ganapathi' AND NOT EXISTS (SELECT 1 FROM dbo.SevaMaster x WHERE x.TempleId = t.TempleId);
INSERT INTO dbo.SevaMaster (TempleId, DeityId, CategoryId, SevaName, Amount, Description, IsActive)
SELECT t.TempleId, d.DeityId, c.CategoryId, v.SevaName, v.Amount, v.Description, v.IsActive
FROM dbo.Temples t JOIN dbo.Locations l ON l.LocationId = t.LocationId AND l.LocationName = N'Tirupati Balaji' CROSS JOIN (VALUES
    (N'Abhishekam Pradhana', N'Abhishekam', N'Sri Venkateswara Swamy', 2500, N'', 1),
    (N'Pradhana Archana', N'Archana', N'Sri Venkateswara Swamy', 100, N'', 1),
    (N'Kalyanam Pradhana', N'Kalyanam', N'Sri Venkateswara Swamy', 5000, N'', 1)
) v (SevaName, CategoryName, DeityName, Amount, Description, IsActive)
JOIN dbo.SevaCategories c ON c.CategoryName = v.CategoryName
OUTER APPLY (SELECT TOP 1 dd.DeityId FROM dbo.Deities dd WHERE dd.TempleId = t.TempleId AND dd.DeityName = v.DeityName ORDER BY dd.DeityId) d
WHERE t.TempleName = N'Sri Venkateswara Swamy' AND NOT EXISTS (SELECT 1 FROM dbo.SevaMaster x WHERE x.TempleId = t.TempleId);
INSERT INTO dbo.SevaMaster (TempleId, DeityId, CategoryId, SevaName, Amount, Description, IsActive)
SELECT t.TempleId, d.DeityId, c.CategoryId, v.SevaName, v.Amount, v.Description, v.IsActive
FROM dbo.Temples t JOIN dbo.Locations l ON l.LocationId = t.LocationId AND l.LocationName = N'Srisailam' CROSS JOIN (VALUES
    (N'Rudhrabhisekam Pradhana', N'Abhishekam', N'Sri Mallikarjuna Swamy', 2500, N'', 1),
    (N'Bilvarchana', N'Archana', N'Sri Mallikarjuna Swamy', 50, N'', 1)
) v (SevaName, CategoryName, DeityName, Amount, Description, IsActive)
JOIN dbo.SevaCategories c ON c.CategoryName = v.CategoryName
OUTER APPLY (SELECT TOP 1 dd.DeityId FROM dbo.Deities dd WHERE dd.TempleId = t.TempleId AND dd.DeityName = v.DeityName ORDER BY dd.DeityId) d
WHERE t.TempleName = N'Sri Mallikarjuna Swamy' AND NOT EXISTS (SELECT 1 FROM dbo.SevaMaster x WHERE x.TempleId = t.TempleId);
GO

-- ---------- 5. Counters per location ----------
INSERT INTO dbo.Counters (LocationId, CounterName, Location, IsActive)
SELECT l.LocationId, v.CounterName, v.Location, v.IsActive
FROM dbo.Locations l CROSS JOIN (VALUES
    (N'Seva Counter 01', N'Main Hall - Counter 1', 1),
    (N'Seva Counter 02', N'Main Hall - Counter 2', 1),
    (N'Laddu Counter 01', N'Prasadam Hall', 1),
    (N'Goshala Counter 01', N'Goshala Entrance', 1)
) v (CounterName, Location, IsActive)
WHERE l.LocationName = N'Uttara Tirupati' AND NOT EXISTS (SELECT 1 FROM dbo.Counters x WHERE x.LocationId = l.LocationId);
INSERT INTO dbo.Counters (LocationId, CounterName, Location, IsActive)
SELECT l.LocationId, v.CounterName, v.Location, v.IsActive
FROM dbo.Locations l CROSS JOIN (VALUES
    (N'Tirumala Counter 01', N'Main Queue Complex', 1)
) v (CounterName, Location, IsActive)
WHERE l.LocationName = N'Tirupati Balaji' AND NOT EXISTS (SELECT 1 FROM dbo.Counters x WHERE x.LocationId = l.LocationId);
INSERT INTO dbo.Counters (LocationId, CounterName, Location, IsActive)
SELECT l.LocationId, v.CounterName, v.Location, v.IsActive
FROM dbo.Locations l CROSS JOIN (VALUES
    (N'Srisailam Counter 01', N'Temple Entrance', 1)
) v (CounterName, Location, IsActive)
WHERE l.LocationName = N'Srisailam' AND NOT EXISTS (SELECT 1 FROM dbo.Counters x WHERE x.LocationId = l.LocationId);
GO

-- ---------- 6. Seva time slots: global defaults, location / temple overrides (only into an empty table) ----------
IF NOT EXISTS (SELECT 1 FROM dbo.SevaTimeSlots)
BEGIN
    INSERT INTO dbo.SevaTimeSlots (LocationId, TempleId, SlotTime, SlotLabel, IsActive, DisplayOrder)
    SELECT NULL, NULL, v.SlotTime, v.SlotLabel, v.IsActive, v.DisplayOrder FROM (VALUES
        (N'05:00', N'05:00 AM', 1, 1),
        (N'05:30', N'05:30 AM', 1, 2),
        (N'06:00', N'06:00 AM', 1, 3),
        (N'06:30', N'06:30 AM', 1, 4),
        (N'07:00', N'07:00 AM', 1, 5),
        (N'07:30', N'07:30 AM', 1, 6),
        (N'08:00', N'08:00 AM', 1, 7),
        (N'08:30', N'08:30 AM', 1, 8),
        (N'09:00', N'09:00 AM', 1, 9),
        (N'09:30', N'09:30 AM', 1, 10),
        (N'10:00', N'10:00 AM', 1, 11),
        (N'10:30', N'10:30 AM', 1, 12),
        (N'11:00', N'11:00 AM', 1, 13),
        (N'11:30', N'11:30 AM', 1, 14),
        (N'12:00', N'12:00 PM', 1, 15),
        (N'16:00', N'04:00 PM', 1, 16),
        (N'16:30', N'04:30 PM', 1, 17),
        (N'17:00', N'05:00 PM', 1, 18),
        (N'17:30', N'05:30 PM', 1, 19),
        (N'18:00', N'06:00 PM', 1, 20),
        (N'18:30', N'06:30 PM', 1, 21),
        (N'19:00', N'07:00 PM', 1, 22),
        (N'19:30', N'07:30 PM', 1, 23),
        (N'20:00', N'08:00 PM', 1, 24)
    ) v (SlotTime, SlotLabel, IsActive, DisplayOrder);
    INSERT INTO dbo.SevaTimeSlots (LocationId, TempleId, SlotTime, SlotLabel, IsActive, DisplayOrder)
    SELECT l.LocationId, NULL, v.SlotTime, v.SlotLabel, v.IsActive, v.DisplayOrder FROM dbo.Locations l CROSS JOIN (VALUES
        (N'04:30', N'04:30 AM', 1, 1),
        (N'06:00', N'06:00 AM', 1, 2),
        (N'09:00', N'09:00 AM', 1, 3),
        (N'12:00', N'12:00 PM', 1, 4),
        (N'18:00', N'06:00 PM', 1, 5),
        (N'19:30', N'07:30 PM', 1, 6)
    ) v (SlotTime, SlotLabel, IsActive, DisplayOrder) WHERE l.LocationName = N'Srisailam';
END
GO

-- ---------- 7. Super-admin flag and lookup masters ----------
UPDATE dbo.Roles SET IsSuperAdmin = 1 WHERE RoleName IN (N'SuperAdmin') AND NOT EXISTS (SELECT 1 FROM dbo.Roles r WHERE r.IsSuperAdmin = 1);
DECLARE @BT TABLE (TypeName NVARCHAR(50), TokenPrefix NVARCHAR(10), ScreenKey NVARCHAR(50), Description NVARCHAR(200), Icon NVARCHAR(30), UsesSevaMaster BIT, RequiresTemple BIT, RequiresSchedule BIT, RequiresDevotee BIT, CaptureGothram BIT, AllowAdvance BIT, IsActive BIT, IsDefault BIT, DisplayOrder INT);
INSERT INTO @BT (TypeName, TokenPrefix, ScreenKey, Description, Icon, UsesSevaMaster, RequiresTemple, RequiresSchedule, RequiresDevotee, CaptureGothram, AllowAdvance, IsActive, IsDefault, DisplayOrder) VALUES
    (N'Seva', N'SV', N'seva_booking', N'Book pooja and seva tickets', N'Flower2', 1, 1, 1, 1, 1, 1, 1, 1, 1),
    (N'Laddu', N'LD', N'laddu_booking', N'Issue laddu collection token', N'Package', 0, 0, 0, 1, 0, 1, 1, 0, 2),
    (N'Goshala', N'GH', N'goshala_tickets', N'Ticket and donation entry', N'Ticket', 0, 0, 0, 1, 0, 1, 1, 0, 3);
IF NOT EXISTS (SELECT 1 FROM dbo.BookingTypes)
    INSERT INTO dbo.BookingTypes (TypeName, TokenPrefix, ScreenKey, Description, Icon, UsesSevaMaster, RequiresTemple, RequiresSchedule, RequiresDevotee, CaptureGothram, AllowAdvance, IsActive, IsDefault, DisplayOrder) SELECT TypeName, TokenPrefix, ScreenKey, Description, Icon, UsesSevaMaster, RequiresTemple, RequiresSchedule, RequiresDevotee, CaptureGothram, AllowAdvance, IsActive, IsDefault, DisplayOrder FROM @BT;
-- types from v3: give them their screen, item and rule settings once
UPDATE x SET ScreenKey = v.ScreenKey, Description = v.Description, Icon = v.Icon, UsesSevaMaster = v.UsesSevaMaster, RequiresTemple = v.RequiresTemple,
       RequiresSchedule = v.RequiresSchedule, RequiresDevotee = v.RequiresDevotee, CaptureGothram = v.CaptureGothram, AllowAdvance = v.AllowAdvance
FROM dbo.BookingTypes x JOIN @BT v ON v.TypeName = x.TypeName WHERE x.ScreenKey IS NULL;
-- your own types (not in the seed): screen key '<type>_booking', the same rule the API uses
UPDATE dbo.BookingTypes SET ScreenKey = LOWER(REPLACE(LTRIM(RTRIM(TypeName)), N' ', N'_')) + N'_booking' WHERE ScreenKey IS NULL;
IF NOT EXISTS (SELECT 1 FROM dbo.PaymentModes)
    INSERT INTO dbo.PaymentModes (ModeName, IsActive, IsDefault, DisplayOrder, ShowUpiQr) VALUES
    (N'Cash', 1, 1, 1, 0),
    (N'UPI', 1, 0, 2, 1),
    (N'Pine Labs', 1, 0, 3, 0);
IF NOT EXISTS (SELECT 1 FROM dbo.BookingStatuses)
    INSERT INTO dbo.BookingStatuses (StatusName, IsActive, IsDefault, DisplayOrder, IsCancelled) VALUES
    (N'Paid', 1, 1, 1, 0),
    (N'Pending', 1, 0, 2, 0),
    (N'Cancelled', 1, 0, 3, 1),
    (N'Refunded', 1, 0, 4, 1);
IF NOT EXISTS (SELECT 1 FROM dbo.MemberFrequencies)
    INSERT INTO dbo.MemberFrequencies (FrequencyName, IsActive, IsDefault, DisplayOrder) VALUES
    (N'Annual', 1, 1, 1),
    (N'Monthly', 1, 0, 2),
    (N'One-time', 1, 0, 3),
    (N'Custom', 1, 0, 4);
IF NOT EXISTS (SELECT 1 FROM dbo.MemberStatuses)
    INSERT INTO dbo.MemberStatuses (StatusName, IsActive, IsDefault, DisplayOrder) VALUES
    (N'Active', 1, 1, 1),
    (N'Inactive', 1, 0, 2),
    (N'Expired', 1, 0, 3);
UPDATE dbo.PaymentModes SET ShowUpiQr = 1 WHERE ModeName IN (N'UPI') AND NOT EXISTS (SELECT 1 FROM dbo.PaymentModes x WHERE x.ShowUpiQr = 1);
UPDATE dbo.BookingStatuses SET IsCancelled = 1 WHERE StatusName IN (N'Cancelled', N'Refunded') AND NOT EXISTS (SELECT 1 FROM dbo.BookingStatuses x WHERE x.IsCancelled = 1);
-- older bookings: link the booking type by name
UPDATE b SET BookingTypeId = bt.BookingTypeId FROM dbo.Bookings b JOIN dbo.BookingTypes bt ON bt.TypeName = b.BookingType WHERE b.BookingTypeId IS NULL;
GO

-- ---------- 8. Screens: one per booking type, advance booking, item master, lookup masters ----------
DECLARE @FirstV4 BIT = CASE WHEN EXISTS (SELECT 1 FROM dbo.Screens WHERE ScreenKey = N'item_master') THEN 0 ELSE 1 END;
DECLARE @S TABLE (SeedOrder INT, ScreenKey NVARCHAR(50), ScreenName NVARCHAR(100), ScreenGroup NVARCHAR(50), DisplayOrder INT, IsBookingScreen BIT);
INSERT INTO @S (SeedOrder, ScreenKey, ScreenName, ScreenGroup, DisplayOrder, IsBookingScreen) VALUES
    (1, N'overview', N'Overview', N'Operations', 1, 0),
    (2, N'seva_booking', N'Seva Booking', N'Operations', 2, 1),
    (20, N'laddu_booking', N'Laddu Booking', N'Operations', 3, 1),
    (21, N'goshala_tickets', N'Goshala Tickets', N'Operations', 4, 1),
    (22, N'advance_booking', N'Advance Booking', N'Operations', 5, 0),
    (3, N'bookings', N'Bookings', N'Operations', 6, 0),
    (4, N'lifetime_members', N'Lifetime Members', N'Operations', 7, 0),
    (5, N'reports', N'Reports', N'Reports', 8, 0),
    (6, N'locations', N'Locations', N'Administration', 9, 0),
    (7, N'temple_mgmt', N'Temples', N'Administration', 10, 0),
    (8, N'deity_mgmt', N'Deities', N'Administration', 11, 0),
    (9, N'seva_master', N'Seva Master', N'Administration', 12, 0),
    (23, N'item_master', N'Item Master', N'Administration', 13, 0),
    (10, N'seva_categories', N'Seva Categories', N'Administration', 14, 0),
    (11, N'counters', N'Counters', N'Administration', 15, 0),
    (12, N'user_mgmt', N'User Management', N'Administration', 16, 0),
    (13, N'screen_allocation', N'Screen Allocation', N'Administration', 17, 0),
    (14, N'booking_types', N'Booking Types', N'Masters', 18, 0),
    (15, N'payment_modes', N'Payment Modes', N'Masters', 19, 0),
    (16, N'booking_statuses', N'Booking Statuses', N'Masters', 20, 0),
    (17, N'time_slots', N'Seva Time Slots', N'Masters', 21, 0),
    (18, N'member_frequencies', N'Member Frequencies', N'Masters', 22, 0),
    (19, N'member_statuses', N'Member Statuses', N'Masters', 23, 0);
INSERT INTO dbo.Screens (ScreenKey, ScreenName, ScreenGroup, DisplayOrder, IsActive, IsBookingScreen)
SELECT v.ScreenKey, v.ScreenName, v.ScreenGroup, v.DisplayOrder, 1, v.IsBookingScreen FROM @S v
WHERE NOT EXISTS (SELECT 1 FROM dbo.Screens x WHERE x.ScreenKey = v.ScreenKey)
ORDER BY v.SeedOrder;
-- first v4 run only: align menu groups and order with the new layout (screen names are left alone)
IF @FirstV4 = 1
    UPDATE x SET ScreenGroup = v.ScreenGroup, DisplayOrder = v.DisplayOrder FROM dbo.Screens x JOIN @S v ON v.ScreenKey = x.ScreenKey;
UPDATE x SET IsBookingScreen = 1 FROM dbo.Screens x JOIN @S v ON v.ScreenKey = x.ScreenKey WHERE v.IsBookingScreen = 1 AND x.IsBookingScreen = 0;
-- every booking type has its own screen (your own v3 types included), as the API creates them
INSERT INTO dbo.Screens (ScreenKey, ScreenName, ScreenGroup, DisplayOrder, IsActive, IsBookingScreen)
SELECT bt.ScreenKey, bt.TypeName + N' Booking', N'Operations', 100 + ISNULL(bt.DisplayOrder, 0), 1, 1
FROM dbo.BookingTypes bt
WHERE bt.ScreenKey IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.Screens x WHERE x.ScreenKey = bt.ScreenKey);
GO

-- ---------- 9. Role x screen permissions (adds missing rows only - your changes are kept) ----------
DECLARE @P TABLE (RoleName NVARCHAR(50), ScreenKey NVARCHAR(50), CanView BIT, CanCreate BIT, CanEdit BIT, CanDelete BIT);
INSERT INTO @P (RoleName, ScreenKey, CanView, CanCreate, CanEdit, CanDelete) VALUES
    (N'SuperAdmin', N'overview', 1, 1, 1, 1),
    (N'SuperAdmin', N'seva_booking', 1, 1, 1, 1),
    (N'SuperAdmin', N'bookings', 1, 1, 1, 1),
    (N'SuperAdmin', N'lifetime_members', 1, 1, 1, 1),
    (N'SuperAdmin', N'reports', 1, 1, 1, 1),
    (N'SuperAdmin', N'locations', 1, 1, 1, 1),
    (N'SuperAdmin', N'temple_mgmt', 1, 1, 1, 1),
    (N'SuperAdmin', N'deity_mgmt', 1, 1, 1, 1),
    (N'SuperAdmin', N'seva_master', 1, 1, 1, 1),
    (N'SuperAdmin', N'seva_categories', 1, 1, 1, 1),
    (N'SuperAdmin', N'counters', 1, 1, 1, 1),
    (N'SuperAdmin', N'user_mgmt', 1, 1, 1, 1),
    (N'SuperAdmin', N'screen_allocation', 1, 1, 1, 1),
    (N'SuperAdmin', N'booking_types', 1, 1, 1, 1),
    (N'SuperAdmin', N'payment_modes', 1, 1, 1, 1),
    (N'SuperAdmin', N'booking_statuses', 1, 1, 1, 1),
    (N'SuperAdmin', N'time_slots', 1, 1, 1, 1),
    (N'SuperAdmin', N'member_frequencies', 1, 1, 1, 1),
    (N'SuperAdmin', N'member_statuses', 1, 1, 1, 1),
    (N'Admin', N'overview', 1, 1, 1, 1),
    (N'Admin', N'seva_booking', 1, 1, 1, 1),
    (N'Admin', N'bookings', 1, 1, 1, 1),
    (N'Admin', N'lifetime_members', 1, 1, 1, 1),
    (N'Admin', N'reports', 1, 0, 0, 0),
    (N'Admin', N'locations', 1, 1, 1, 1),
    (N'Admin', N'temple_mgmt', 1, 1, 1, 1),
    (N'Admin', N'deity_mgmt', 1, 1, 1, 1),
    (N'Admin', N'seva_master', 1, 1, 1, 1),
    (N'Admin', N'seva_categories', 1, 1, 1, 1),
    (N'Admin', N'counters', 1, 1, 1, 1),
    (N'Admin', N'user_mgmt', 1, 1, 1, 0),
    (N'Admin', N'screen_allocation', 1, 1, 1, 0),
    (N'Admin', N'booking_types', 1, 1, 1, 1),
    (N'Admin', N'payment_modes', 1, 1, 1, 1),
    (N'Admin', N'booking_statuses', 1, 1, 1, 1),
    (N'Admin', N'time_slots', 1, 1, 1, 1),
    (N'Admin', N'member_frequencies', 1, 1, 1, 1),
    (N'Admin', N'member_statuses', 1, 1, 1, 1),
    (N'Operator', N'overview', 1, 0, 0, 0),
    (N'Operator', N'seva_booking', 1, 1, 1, 0),
    (N'Operator', N'bookings', 1, 0, 1, 0),
    (N'Operator', N'lifetime_members', 1, 1, 1, 0),
    (N'Operator', N'reports', 1, 0, 0, 0),
    (N'Viewer', N'overview', 1, 0, 0, 0),
    (N'Viewer', N'bookings', 1, 0, 0, 0),
    (N'Viewer', N'reports', 1, 0, 0, 0),
    (N'SuperAdmin', N'laddu_booking', 1, 1, 1, 1),
    (N'SuperAdmin', N'goshala_tickets', 1, 1, 1, 1),
    (N'SuperAdmin', N'advance_booking', 1, 1, 1, 1),
    (N'SuperAdmin', N'item_master', 1, 1, 1, 1),
    (N'Admin', N'laddu_booking', 1, 1, 1, 1),
    (N'Admin', N'goshala_tickets', 1, 1, 1, 1),
    (N'Admin', N'advance_booking', 1, 1, 1, 1),
    (N'Admin', N'item_master', 1, 1, 1, 1),
    (N'Operator', N'laddu_booking', 1, 1, 1, 0),
    (N'Operator', N'goshala_tickets', 1, 1, 1, 0),
    (N'Operator', N'advance_booking', 1, 1, 1, 0);
INSERT INTO dbo.ScreenPermissions (RoleId, ScreenId, CanView, CanCreate, CanEdit, CanDelete)
SELECT r.RoleId, s.ScreenId, p.CanView, p.CanCreate, p.CanEdit, p.CanDelete
FROM @P p JOIN dbo.Roles r ON r.RoleName = p.RoleName JOIN dbo.Screens s ON s.ScreenKey = p.ScreenKey
WHERE NOT EXISTS (SELECT 1 FROM dbo.ScreenPermissions x WHERE x.RoleId = r.RoleId AND x.ScreenId = s.ScreenId);
-- super-admin roles: full rights on any screen that still has no row (e.g. screens of your own booking types)
INSERT INTO dbo.ScreenPermissions (RoleId, ScreenId, CanView, CanCreate, CanEdit, CanDelete)
SELECT r.RoleId, s.ScreenId, 1, 1, 1, 1 FROM dbo.Roles r CROSS JOIN dbo.Screens s
WHERE r.IsSuperAdmin = 1 AND NOT EXISTS (SELECT 1 FROM dbo.ScreenPermissions x WHERE x.RoleId = r.RoleId AND x.ScreenId = s.ScreenId);
GO

-- ---------- 10. Item Master: each booking type's own items & prices per location (only into an empty table) ----------
IF NOT EXISTS (SELECT 1 FROM dbo.ItemMaster)
    INSERT INTO dbo.ItemMaster (LocationId, BookingTypeId, TempleId, ItemName, Amount, AllowCustomAmount, MinAmount, Unit, Description, IsActive, DisplayOrder)
    SELECT l.LocationId, bt.BookingTypeId, t.TempleId, v.ItemName, v.Amount, v.AllowCustomAmount, v.MinAmount, v.Unit, v.Description, v.IsActive, v.DisplayOrder
    FROM (VALUES
        (N'Uttara Tirupati', N'Laddu', CAST(NULL AS NVARCHAR(100)), (N'Laddu ' + NCHAR(8211) + N' Standard'), 50, 0, 0, N'Nos', N'', 1, 1),
        (N'Uttara Tirupati', N'Laddu', CAST(NULL AS NVARCHAR(100)), (N'Laddu ' + NCHAR(8211) + N' Special'), 200, 0, 0, N'Nos', N'', 1, 2),
        (N'Uttara Tirupati', N'Laddu', CAST(NULL AS NVARCHAR(100)), N'Vada Prasadam', 30, 0, 0, N'Nos', N'', 1, 3),
        (N'Uttara Tirupati', N'Goshala', CAST(NULL AS NVARCHAR(100)), N'Goshala Entry Ticket', 20, 0, 0, N'Person', N'', 1, 4),
        (N'Uttara Tirupati', N'Goshala', CAST(NULL AS NVARCHAR(100)), N'Goshala Donation', 116, 1, 10, N'Donation', N'Devotee may offer any amount', 1, 5),
        (N'Uttara Tirupati', N'Goshala', CAST(NULL AS NVARCHAR(100)), N'Go Puja', 516, 0, 0, N'Puja', N'', 1, 6),
        (N'Tirupati Balaji', N'Laddu', CAST(NULL AS NVARCHAR(100)), (N'Laddu ' + NCHAR(8211) + N' Standard'), 50, 0, 0, N'Nos', N'', 1, 7),
        (N'Tirupati Balaji', N'Laddu', CAST(NULL AS NVARCHAR(100)), (N'Laddu ' + NCHAR(8211) + N' Kalyanotsavam'), 200, 0, 0, N'Nos', N'', 1, 8),
        (N'Tirupati Balaji', N'Goshala', CAST(NULL AS NVARCHAR(100)), N'Goshala Entry Ticket', 10, 0, 0, N'Person', N'', 1, 9),
        (N'Tirupati Balaji', N'Goshala', CAST(NULL AS NVARCHAR(100)), N'Goshala Donation', 100, 1, 10, N'Donation', N'', 1, 10),
        (N'Srisailam', N'Laddu', CAST(NULL AS NVARCHAR(100)), (N'Laddu ' + NCHAR(8211) + N' Standard'), 40, 0, 0, N'Nos', N'', 1, 11),
        (N'Srisailam', N'Laddu', CAST(NULL AS NVARCHAR(100)), (N'Laddu ' + NCHAR(8211) + N' Special'), 150, 0, 0, N'Nos', N'', 1, 12),
        (N'Srisailam', N'Goshala', CAST(NULL AS NVARCHAR(100)), N'Goshala Entry Ticket', 10, 0, 0, N'Person', N'', 1, 13),
        (N'Srisailam', N'Goshala', CAST(NULL AS NVARCHAR(100)), N'Goshala Donation', 101, 1, 10, N'Donation', N'', 1, 14)
    ) v (LocationName, TypeName, TempleName, ItemName, Amount, AllowCustomAmount, MinAmount, Unit, Description, IsActive, DisplayOrder)
    JOIN dbo.Locations l ON l.LocationName = v.LocationName
    JOIN dbo.BookingTypes bt ON bt.TypeName = v.TypeName
    OUTER APPLY (SELECT TOP 1 tt.TempleId FROM dbo.Temples tt WHERE tt.LocationId = l.LocationId AND tt.TempleName = v.TempleName ORDER BY tt.TempleId) t
    WHERE v.TempleName IS NULL OR t.TempleId IS NOT NULL;
GO

-- ---------- 11. Users & location access ----------
-- the admin hash shipped in the original init.sql does not match 'admin123' - reset it (change it after first login)
UPDATE dbo.Users SET PasswordHash = N'$2a$10$iDopLtLjBaah2a8At1IWGe2rWgcJOnOk3tQzh7F0fefG3I095lwzi' WHERE Username = N'admin' AND PasswordHash = N'$2b$10$8K1p/o0KN7yGpGXvfVDqSOyhRQJXYMDnRMKbPkCXnE8UZcrqG1Oia';
-- demo accounts are only added to a fresh database ('admin' is the only user); re-password or remove them in production
IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE Username <> N'admin')
BEGIN
    INSERT INTO dbo.Users (Username, PasswordHash, FullName, Mobile, Email, RoleId, IsActive, AllLocations)
    SELECT v.Username, v.PasswordHash, v.FullName, v.Mobile, v.Email, (SELECT TOP 1 r.RoleId FROM dbo.Roles r WHERE r.RoleName = v.RoleName ORDER BY r.RoleId), v.IsActive, v.AllLocations
    FROM (VALUES
        (N'operator', N'$2a$10$yCcfmEaJAjg2SvRM6ouEIOXaF3SDKVR/XyICpisoLSM08W59bMAuG', N'Counter Operator', N'9888888888', N'operator@example.org', N'Operator', 1, 0),
        (N'viewer', N'$2a$10$YyrOfTM9OLx.4RkOElti6eX7dkOvs8ZF0qgl5Oz82KK4DQ/MDuDqi', N'Report Viewer', N'9777777777', N'viewer@example.org', N'Viewer', 1, 1),
        (N'manager', N'$2a$10$eIH3eR1DcGDT7ssyOna7w.y3i/xXptpbJd6QxwuxhlRfNqaPTAv7y', N'Temple Manager', N'9666666666', N'manager@example.org', N'Admin', 1, 0)
    ) v (Username, PasswordHash, FullName, Mobile, Email, RoleName, IsActive, AllLocations);
    INSERT INTO dbo.UserLocations (UserId, LocationId)
    SELECT u.UserId, l.LocationId FROM (VALUES
        (N'operator', N'Uttara Tirupati'),
        (N'manager', N'Uttara Tirupati'),
        (N'manager', N'Tirupati Balaji')
    ) v (Username, LocationName)
    JOIN dbo.Users u ON u.Username = v.Username JOIN dbo.Locations l ON l.LocationName = v.LocationName
    WHERE NOT EXISTS (SELECT 1 FROM dbo.UserLocations x WHERE x.UserId = u.UserId AND x.LocationId = l.LocationId);
    UPDATE c SET AssignedUserId = u.UserId FROM dbo.Counters c JOIN dbo.Locations l ON l.LocationId = c.LocationId JOIN dbo.Users u ON u.Username = N'admin'
    WHERE l.LocationName = N'Uttara Tirupati' AND c.CounterName = N'Seva Counter 01' AND c.AssignedUserId IS NULL;
    PRINT 'Demo users added.';
END
GO

-- ---------- 12. Number generators: financial-year series, formats from AppSettings (nothing hardcoded) ----------
IF OBJECT_ID(N'dbo.sp_NextNumber', N'P') IS NOT NULL DROP PROCEDURE dbo.sp_NextNumber;
GO
-- Issues the next number of a series. Every series restarts each financial year: AppSettings.financialYearStartMonth
-- (4 = April, the Indian financial year April-March). Formats come from AppSettings (bookingNumberFormat,
-- tokenNumberFormat, memberNumberFormat) and may use {PREFIX} {FY} (2627) {FYLONG} (2026-27) {LOC} (location code)
-- {SEQ} and {SEQ3}..{SEQ8} (zero-padded counter). A format containing {LOC} gives each location its own series.
-- Concurrency-safe: the counter row is locked until the caller's transaction ends, so numbers never repeat or skip.
CREATE PROCEDURE dbo.sp_NextNumber
    @Kind NVARCHAR(20),            -- BOOKING | TOKEN | MEMBER
    @BusinessDate DATE = NULL,     -- the booking date in the temple's time zone (default: today)
    @LocationId INT = NULL,
    @BookingTypeId INT = NULL,     -- TOKEN: the booking type whose TokenPrefix is used
    @Number NVARCHAR(50) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @fmt NVARCHAR(100), @prefix NVARCHAR(20), @startMonth INT, @fyStart INT, @fy NVARCHAR(10), @fyLong NVARCHAR(10),
            @loc NVARCHAR(20), @key NVARCHAR(100), @v INT, @digits NVARCHAR(12), @w INT;
    IF @BusinessDate IS NULL SET @BusinessDate = CAST(GETDATE() AS DATE);
    SELECT @startMonth = TRY_CAST(SettingValue AS INT) FROM dbo.AppSettings WHERE SettingKey = N'financialYearStartMonth';
    IF @startMonth IS NULL OR @startMonth NOT BETWEEN 1 AND 12 SET @startMonth = 4;
    SET @fyStart = YEAR(@BusinessDate) - CASE WHEN MONTH(@BusinessDate) < @startMonth THEN 1 ELSE 0 END;
    IF @startMonth = 1
        SELECT @fy = CAST(@fyStart AS NVARCHAR(4)), @fyLong = CAST(@fyStart AS NVARCHAR(4));
    ELSE
        SELECT @fy = RIGHT(CAST(@fyStart AS NVARCHAR(4)), 2) + RIGHT(CAST(@fyStart + 1 AS NVARCHAR(4)), 2),
               @fyLong = CAST(@fyStart AS NVARCHAR(4)) + N'-' + RIGHT(CAST(@fyStart + 1 AS NVARCHAR(4)), 2);

    IF @Kind = N'BOOKING'
        SELECT @fmt = (SELECT SettingValue FROM dbo.AppSettings WHERE SettingKey = N'bookingNumberFormat'),
               @prefix = (SELECT SettingValue FROM dbo.AppSettings WHERE SettingKey = N'bookingNumberPrefix');
    ELSE IF @Kind = N'TOKEN'
        SELECT @fmt = (SELECT SettingValue FROM dbo.AppSettings WHERE SettingKey = N'tokenNumberFormat'),
               @prefix = COALESCE((SELECT TokenPrefix FROM dbo.BookingTypes WHERE BookingTypeId = @BookingTypeId),
                                  (SELECT SettingValue FROM dbo.AppSettings WHERE SettingKey = N'fallbackTokenPrefix'));
    ELSE IF @Kind = N'MEMBER'
        SELECT @fmt = (SELECT SettingValue FROM dbo.AppSettings WHERE SettingKey = N'memberNumberFormat'),
               @prefix = (SELECT SettingValue FROM dbo.AppSettings WHERE SettingKey = N'memberNumberPrefix');
    ELSE
    BEGIN
        RAISERROR(N'sp_NextNumber: unknown number kind %s', 16, 1, @Kind);
        RETURN;
    END
    SET @fmt = ISNULL(NULLIF(LTRIM(RTRIM(@fmt)), N''), N'{PREFIX}-{FY}-{SEQ5}');
    SET @prefix = ISNULL(@prefix, N'');
    SET @loc = N'';
    IF CHARINDEX(N'{LOC}', @fmt) > 0
        SELECT @loc = ISNULL(NULLIF(LocationCode, N''), CAST(LocationId AS NVARCHAR(10))) FROM dbo.Locations WHERE LocationId = @LocationId;
    SET @key = @Kind + N'|' + @prefix + N'|' + @fyLong + CASE WHEN CHARINDEX(N'{LOC}', @fmt) > 0 THEN N'|' + @loc ELSE N'' END;

    BEGIN TRANSACTION;   -- joins the caller's transaction when there is one
        UPDATE dbo.NumberSequences WITH (UPDLOCK, HOLDLOCK) SET @v = LastValue = LastValue + 1, UpdatedAt = GETDATE() WHERE SeqKey = @key;
        IF @@ROWCOUNT = 0
        BEGIN
            SET @v = 1;
            INSERT INTO dbo.NumberSequences (SeqKey, LastValue) VALUES (@key, 1);
        END
    COMMIT TRANSACTION;

    SET @digits = CAST(@v AS NVARCHAR(12));
    SET @Number = REPLACE(REPLACE(REPLACE(REPLACE(@fmt, N'{PREFIX}', @prefix), N'{FYLONG}', @fyLong), N'{FY}', @fy), N'{LOC}', @loc);
    SET @w = 3;
    WHILE @w <= 8
    BEGIN
        SET @Number = REPLACE(@Number, N'{SEQ' + CAST(@w AS NVARCHAR(1)) + N'}', CASE WHEN LEN(@digits) >= @w THEN @digits ELSE RIGHT(REPLICATE(N'0', @w) + @digits, @w) END);
        SET @w = @w + 1;
    END
    SET @Number = REPLACE(@Number, N'{SEQ}', @digits);
END
GO
-- the original procedure names keep working and now use the financial-year series
IF OBJECT_ID(N'dbo.sp_GenerateBookingNumber', N'P') IS NOT NULL DROP PROCEDURE dbo.sp_GenerateBookingNumber;
GO
CREATE PROCEDURE dbo.sp_GenerateBookingNumber @BookingNumber NVARCHAR(30) OUTPUT AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @n NVARCHAR(50);
    EXEC dbo.sp_NextNumber @Kind = N'BOOKING', @Number = @n OUTPUT;
    SET @BookingNumber = @n;
END
GO
IF OBJECT_ID(N'dbo.sp_GenerateTokenNumber', N'P') IS NOT NULL DROP PROCEDURE dbo.sp_GenerateTokenNumber;
GO
CREATE PROCEDURE dbo.sp_GenerateTokenNumber @BookingType NVARCHAR(50), @TokenNumber NVARCHAR(30) OUTPUT AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @n NVARCHAR(50);
    DECLARE @typeId INT = (SELECT TOP 1 BookingTypeId FROM dbo.BookingTypes WHERE TypeName = @BookingType AND IsActive = 1);
    EXEC dbo.sp_NextNumber @Kind = N'TOKEN', @BookingTypeId = @typeId, @Number = @n OUTPUT;
    SET @TokenNumber = @n;
END
GO

-- ---------- Fresh install only: the seed rows were created by the setup, i.e. the 'admin' account ----------
-- (skipped once the database holds bookings, so re-running init.sql never re-labels real records)
IF NOT EXISTS (SELECT 1 FROM dbo.Bookings)
BEGIN
    DECLARE @setupUser INT = (SELECT TOP 1 UserId FROM dbo.Users WHERE Username = N'admin');
    UPDATE dbo.Locations SET CreatedBy = @setupUser WHERE CreatedBy IS NULL;
    UPDATE dbo.Temples SET CreatedBy = @setupUser WHERE CreatedBy IS NULL;
    UPDATE dbo.Deities SET CreatedBy = @setupUser WHERE CreatedBy IS NULL;
    UPDATE dbo.SevaCategories SET CreatedBy = @setupUser WHERE CreatedBy IS NULL;
    UPDATE dbo.SevaMaster SET CreatedBy = @setupUser WHERE CreatedBy IS NULL;
    UPDATE dbo.ItemMaster SET CreatedBy = @setupUser WHERE CreatedBy IS NULL;
    UPDATE dbo.Counters SET CreatedBy = @setupUser WHERE CreatedBy IS NULL;
    UPDATE dbo.SevaTimeSlots SET CreatedBy = @setupUser WHERE CreatedBy IS NULL;
    UPDATE dbo.BookingTypes SET CreatedBy = @setupUser WHERE CreatedBy IS NULL;
    UPDATE dbo.PaymentModes SET CreatedBy = @setupUser WHERE CreatedBy IS NULL;
    UPDATE dbo.BookingStatuses SET CreatedBy = @setupUser WHERE CreatedBy IS NULL;
    UPDATE dbo.MemberFrequencies SET CreatedBy = @setupUser WHERE CreatedBy IS NULL;
    UPDATE dbo.MemberStatuses SET CreatedBy = @setupUser WHERE CreatedBy IS NULL;
    UPDATE dbo.Roles SET CreatedBy = @setupUser WHERE CreatedBy IS NULL;
    UPDATE dbo.Screens SET CreatedBy = @setupUser WHERE CreatedBy IS NULL;
    UPDATE dbo.ScreenPermissions SET CreatedBy = @setupUser WHERE CreatedBy IS NULL;
    UPDATE dbo.Users SET CreatedBy = @setupUser WHERE CreatedBy IS NULL AND UserId <> @setupUser;
    UPDATE dbo.LifetimeMembers SET CreatedBy = @setupUser WHERE CreatedBy IS NULL;
    UPDATE dbo.Bookings SET CreatedBy = @setupUser WHERE CreatedBy IS NULL;
    UPDATE dbo.AppSettings SET CreatedBy = @setupUser WHERE CreatedBy IS NULL;
    UPDATE dbo.BookingItems SET CreatedBy = @setupUser WHERE CreatedBy IS NULL;
    UPDATE dbo.UserLocations SET CreatedBy = @setupUser WHERE CreatedBy IS NULL;
END
GO

PRINT 'Database initialization complete (v4.2) - all data in MSSQL, FY numbering, who created / changed every record.';
GO
