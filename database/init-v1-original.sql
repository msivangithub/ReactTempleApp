-- ============================================================
-- Temple Management System - Database Initialization Script
-- Database: TempleApp on DESKTOP-3EHOF5Q\SQL2014
-- ============================================================

-- 1. Create database if not exists
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'TempleApp')
BEGIN
    CREATE DATABASE TempleApp;
END
GO

USE TempleApp;
GO

-- ============================================================
-- TABLE CREATION
-- ============================================================

-- 1. Roles
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Roles]') AND type = 'U')
BEGIN
    CREATE TABLE [dbo].[Roles] (
        RoleId      INT IDENTITY(1,1) PRIMARY KEY,
        RoleName    NVARCHAR(50) NOT NULL,
        Description NVARCHAR(200),
        IsActive    BIT DEFAULT 1,
        CreatedAt   DATETIME DEFAULT GETDATE()
    );
END
GO

-- 2. Users
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Users]') AND type = 'U')
BEGIN
    CREATE TABLE [dbo].[Users] (
        UserId       INT IDENTITY(1,1) PRIMARY KEY,
        Username     NVARCHAR(50) UNIQUE NOT NULL,
        PasswordHash NVARCHAR(255) NOT NULL,
        FullName     NVARCHAR(100),
        Mobile       NVARCHAR(15),
        Email        NVARCHAR(100),
        RoleId       INT,
        IsActive     BIT DEFAULT 1,
        CreatedAt    DATETIME DEFAULT GETDATE(),
        UpdatedAt    DATETIME DEFAULT GETDATE(),
        CONSTRAINT FK_Users_Roles FOREIGN KEY (RoleId) REFERENCES Roles(RoleId)
    );
END
GO

-- 3. Screens
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Screens]') AND type = 'U')
BEGIN
    CREATE TABLE [dbo].[Screens] (
        ScreenId     INT IDENTITY(1,1) PRIMARY KEY,
        ScreenKey    NVARCHAR(50) UNIQUE NOT NULL,
        ScreenName   NVARCHAR(100) NOT NULL,
        ScreenGroup  NVARCHAR(50),
        DisplayOrder INT DEFAULT 0,
        IsActive     BIT DEFAULT 1
    );
END
GO

-- 4. ScreenPermissions
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ScreenPermissions]') AND type = 'U')
BEGIN
    CREATE TABLE [dbo].[ScreenPermissions] (
        PermissionId INT IDENTITY(1,1) PRIMARY KEY,
        RoleId       INT NOT NULL,
        ScreenId     INT NOT NULL,
        CanView      BIT DEFAULT 0,
        CanCreate    BIT DEFAULT 0,
        CanEdit      BIT DEFAULT 0,
        CanDelete    BIT DEFAULT 0,
        CONSTRAINT FK_ScreenPerm_Roles FOREIGN KEY (RoleId) REFERENCES Roles(RoleId),
        CONSTRAINT FK_ScreenPerm_Screens FOREIGN KEY (ScreenId) REFERENCES Screens(ScreenId),
        CONSTRAINT UQ_RoleScreen UNIQUE (RoleId, ScreenId)
    );
END
GO

-- 5. Temples
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Temples]') AND type = 'U')
BEGIN
    CREATE TABLE [dbo].[Temples] (
        TempleId     INT IDENTITY(1,1) PRIMARY KEY,
        TempleName   NVARCHAR(100) NOT NULL,
        Description  NVARCHAR(500),
        Address      NVARCHAR(300),
        IsMainTemple BIT DEFAULT 0,
        IsActive     BIT DEFAULT 1,
        DisplayOrder INT DEFAULT 0,
        CreatedBy    INT,
        CreatedAt    DATETIME DEFAULT GETDATE(),
        UpdatedAt    DATETIME DEFAULT GETDATE(),
        CONSTRAINT FK_Temples_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES Users(UserId)
    );
END
GO

-- 6. Deities
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Deities]') AND type = 'U')
BEGIN
    CREATE TABLE [dbo].[Deities] (
        DeityId      INT IDENTITY(1,1) PRIMARY KEY,
        TempleId     INT NOT NULL,
        DeityName    NVARCHAR(100) NOT NULL,
        Description  NVARCHAR(500),
        IsMainDeity  BIT DEFAULT 0,
        IsActive     BIT DEFAULT 1,
        DisplayOrder INT DEFAULT 0,
        CreatedBy    INT,
        CreatedAt    DATETIME DEFAULT GETDATE(),
        UpdatedAt    DATETIME DEFAULT GETDATE(),
        CONSTRAINT FK_Deities_Temples FOREIGN KEY (TempleId) REFERENCES Temples(TempleId),
        CONSTRAINT FK_Deities_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES Users(UserId)
    );
END
GO

-- 7. SevaCategories
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[SevaCategories]') AND type = 'U')
BEGIN
    CREATE TABLE [dbo].[SevaCategories] (
        CategoryId   INT IDENTITY(1,1) PRIMARY KEY,
        CategoryName NVARCHAR(50) UNIQUE NOT NULL,
        IsActive     BIT DEFAULT 1
    );
END
GO

-- 8. SevaMaster
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[SevaMaster]') AND type = 'U')
BEGIN
    CREATE TABLE [dbo].[SevaMaster] (
        SevaId      INT IDENTITY(1,1) PRIMARY KEY,
        TempleId    INT NOT NULL,
        DeityId     INT NULL,
        CategoryId  INT NOT NULL,
        SevaName    NVARCHAR(150) NOT NULL,
        Amount      DECIMAL(10,2) NOT NULL,
        Description NVARCHAR(300),
        IsActive    BIT DEFAULT 1,
        CreatedBy   INT,
        CreatedAt   DATETIME DEFAULT GETDATE(),
        UpdatedAt   DATETIME DEFAULT GETDATE(),
        CONSTRAINT FK_SevaMaster_Temples FOREIGN KEY (TempleId) REFERENCES Temples(TempleId),
        CONSTRAINT FK_SevaMaster_Deities FOREIGN KEY (DeityId) REFERENCES Deities(DeityId),
        CONSTRAINT FK_SevaMaster_Categories FOREIGN KEY (CategoryId) REFERENCES SevaCategories(CategoryId),
        CONSTRAINT FK_SevaMaster_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES Users(UserId)
    );
END
GO

-- 9. Counters
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Counters]') AND type = 'U')
BEGIN
    CREATE TABLE [dbo].[Counters] (
        CounterId      INT IDENTITY(1,1) PRIMARY KEY,
        CounterName    NVARCHAR(50) NOT NULL,
        Location       NVARCHAR(100),
        IsActive       BIT DEFAULT 1,
        AssignedUserId INT NULL,
        CONSTRAINT FK_Counters_Users FOREIGN KEY (AssignedUserId) REFERENCES Users(UserId)
    );
END
GO

-- 10. Bookings
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[Bookings]') AND type = 'U')
BEGIN
    CREATE TABLE [dbo].[Bookings] (
        BookingId        INT IDENTITY(1,1) PRIMARY KEY,
        BookingNumber    NVARCHAR(20) UNIQUE NOT NULL,
        TokenNumber      NVARCHAR(20) NOT NULL,
        BookingType      NVARCHAR(20) NOT NULL,
        TempleId         INT,
        DeityId          INT NULL,
        DevoteeName      NVARCHAR(100) NOT NULL,
        Mobile           NVARCHAR(15) NOT NULL,
        Gothram          NVARCHAR(100),
        Nakshatram       NVARCHAR(50),
        BookingDate      DATE NOT NULL,
        SevaDate         DATE,
        Remarks          NVARCHAR(300),
        TotalAmount      DECIMAL(10,2),
        PaymentMode      NVARCHAR(20),
        PaymentStatus    NVARCHAR(20) DEFAULT 'Paid',
        CounterId        INT,
        CreatedBy        INT,
        CreatedAt        DATETIME DEFAULT GETDATE(),
        CancelledAt      DATETIME NULL,
        CancelledBy      INT NULL,
        IsAdvanceBooking BIT DEFAULT 0,
        CONSTRAINT FK_Bookings_Temples FOREIGN KEY (TempleId) REFERENCES Temples(TempleId),
        CONSTRAINT FK_Bookings_Deities FOREIGN KEY (DeityId) REFERENCES Deities(DeityId),
        CONSTRAINT FK_Bookings_Counters FOREIGN KEY (CounterId) REFERENCES Counters(CounterId),
        CONSTRAINT FK_Bookings_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES Users(UserId),
        CONSTRAINT FK_Bookings_CancelledBy FOREIGN KEY (CancelledBy) REFERENCES Users(UserId),
        CONSTRAINT CK_Bookings_Type CHECK (BookingType IN ('Seva','Laddu','Goshala')),
        CONSTRAINT CK_Bookings_PayMode CHECK (PaymentMode IN ('Cash','UPI','Pine Labs')),
        CONSTRAINT CK_Bookings_PayStatus CHECK (PaymentStatus IN ('Paid','Pending','Cancelled','Refunded'))
    );
END
GO

-- 11. BookingItems
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[BookingItems]') AND type = 'U')
BEGIN
    CREATE TABLE [dbo].[BookingItems] (
        ItemId      INT IDENTITY(1,1) PRIMARY KEY,
        BookingId   INT NOT NULL,
        SevaId      INT NULL,
        ItemName    NVARCHAR(150) NOT NULL,
        Quantity    INT DEFAULT 1,
        UnitAmount  DECIMAL(10,2),
        TotalAmount DECIMAL(10,2),
        CreatedAt   DATETIME DEFAULT GETDATE(),
        CONSTRAINT FK_BookingItems_Bookings FOREIGN KEY (BookingId) REFERENCES Bookings(BookingId),
        CONSTRAINT FK_BookingItems_SevaMaster FOREIGN KEY (SevaId) REFERENCES SevaMaster(SevaId)
    );
END
GO

-- 12. LifetimeMembers
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[LifetimeMembers]') AND type = 'U')
BEGIN
    CREATE TABLE [dbo].[LifetimeMembers] (
        MemberId     INT IDENTITY(1,1) PRIMARY KEY,
        MemberNumber NVARCHAR(20) UNIQUE,
        MemberName   NVARCHAR(100) NOT NULL,
        Mobile       NVARCHAR(15) NOT NULL,
        Email        NVARCHAR(100),
        Address      NVARCHAR(300),
        TempleId     INT,
        DeityId      INT,
        PoojaName    NVARCHAR(100),
        NextPoojaDate DATE,
        Frequency    NVARCHAR(20),
        Status       NVARCHAR(20) DEFAULT 'Active',
        CreatedBy    INT,
        CreatedAt    DATETIME DEFAULT GETDATE(),
        UpdatedAt    DATETIME DEFAULT GETDATE(),
        CONSTRAINT FK_LifeMembers_Temples FOREIGN KEY (TempleId) REFERENCES Temples(TempleId),
        CONSTRAINT FK_LifeMembers_Deities FOREIGN KEY (DeityId) REFERENCES Deities(DeityId),
        CONSTRAINT FK_LifeMembers_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES Users(UserId),
        CONSTRAINT CK_LifeMembers_Freq CHECK (Frequency IN ('Annual','Monthly','One-time','Custom')),
        CONSTRAINT CK_LifeMembers_Status CHECK (Status IN ('Active','Inactive','Expired'))
    );
END
GO

-- 13. AuditLog
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[AuditLog]') AND type = 'U')
BEGIN
    CREATE TABLE [dbo].[AuditLog] (
        LogId      BIGINT IDENTITY(1,1) PRIMARY KEY,
        UserId     INT,
        Action     NVARCHAR(50),
        TableName  NVARCHAR(50),
        RecordId   INT,
        OldValues  NVARCHAR(MAX),
        NewValues  NVARCHAR(MAX),
        IPAddress  NVARCHAR(50),
        CreatedAt  DATETIME DEFAULT GETDATE(),
        CONSTRAINT FK_AuditLog_Users FOREIGN KEY (UserId) REFERENCES Users(UserId)
    );
END
GO

-- ============================================================
-- STORED PROCEDURES: Booking Number & Token Number Generation
-- ============================================================

-- Generate booking number like BK-YYYYMMDD-NNNN
IF OBJECT_ID(N'[dbo].[sp_GenerateBookingNumber]', 'P') IS NOT NULL
    DROP PROCEDURE [dbo].[sp_GenerateBookingNumber];
GO

CREATE PROCEDURE [dbo].[sp_GenerateBookingNumber]
    @BookingNumber NVARCHAR(20) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Today DATE = GETDATE();
    DECLARE @DatePart NVARCHAR(8) = FORMAT(@Today, 'yyyyMMdd');
    DECLARE @MaxSeq INT;

    SELECT @MaxSeq = ISNULL(MAX(
        CAST(RIGHT(BookingNumber, 4) AS INT)
    ), 0)
    FROM Bookings
    WHERE BookingNumber LIKE 'BK-' + @DatePart + '-%';

    SET @BookingNumber = 'BK-' + @DatePart + '-' + RIGHT('0000' + CAST(@MaxSeq + 1 AS NVARCHAR), 4);
END
GO

-- Generate token number like SV-00001, LD-00001, GH-00001
IF OBJECT_ID(N'[dbo].[sp_GenerateTokenNumber]', 'P') IS NOT NULL
    DROP PROCEDURE [dbo].[sp_GenerateTokenNumber];
GO

CREATE PROCEDURE [dbo].[sp_GenerateTokenNumber]
    @BookingType NVARCHAR(20),
    @TokenNumber NVARCHAR(20) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Prefix NVARCHAR(2);
    DECLARE @MaxSeq INT;

    SET @Prefix = CASE @BookingType
        WHEN 'Seva'    THEN 'SV'
        WHEN 'Laddu'   THEN 'LD'
        WHEN 'Goshala'  THEN 'GH'
        ELSE 'TK'
    END;

    SELECT @MaxSeq = ISNULL(MAX(
        CAST(RIGHT(TokenNumber, 5) AS INT)
    ), 0)
    FROM Bookings
    WHERE TokenNumber LIKE @Prefix + '-%';

    SET @TokenNumber = @Prefix + '-' + RIGHT('00000' + CAST(@MaxSeq + 1 AS NVARCHAR), 5);
END
GO

-- ============================================================
-- SEED DATA
-- ============================================================

-- ---- 1. Roles ----
IF NOT EXISTS (SELECT 1 FROM Roles WHERE RoleName = 'SuperAdmin')
    INSERT INTO Roles (RoleName, Description) VALUES ('SuperAdmin', 'Full system access with all administrative privileges');
IF NOT EXISTS (SELECT 1 FROM Roles WHERE RoleName = 'Admin')
    INSERT INTO Roles (RoleName, Description) VALUES ('Admin', 'Administrative access to manage temples, sevas and users');
IF NOT EXISTS (SELECT 1 FROM Roles WHERE RoleName = 'Operator')
    INSERT INTO Roles (RoleName, Description) VALUES ('Operator', 'Counter operator for booking sevas and issuing tokens');
IF NOT EXISTS (SELECT 1 FROM Roles WHERE RoleName = 'Viewer')
    INSERT INTO Roles (RoleName, Description) VALUES ('Viewer', 'Read-only access to view reports and dashboards');
GO

-- ---- 2. Default SuperAdmin User ----
-- bcrypt hash of 'admin123' (10 rounds)
IF NOT EXISTS (SELECT 1 FROM Users WHERE Username = 'admin')
    INSERT INTO Users (Username, PasswordHash, FullName, Mobile, Email, RoleId, IsActive)
    VALUES (
        'admin',
        '$2b$10$8K1p/o0KN7yGpGXvfVDqSOyhRQJXYMDnRMKbPkCXnE8UZcrqG1Oia',
        'System Administrator',
        '9999999999',
        'admin@uttaratirupati.org',
        (SELECT RoleId FROM Roles WHERE RoleName = 'SuperAdmin'),
        1
    );
GO

-- ---- 3. Screens ----
IF NOT EXISTS (SELECT 1 FROM Screens WHERE ScreenKey = 'overview')
BEGIN
    INSERT INTO Screens (ScreenKey, ScreenName, ScreenGroup, DisplayOrder) VALUES
    ('overview',          'Overview',           'Operations',    1),
    ('seva_booking',      'Seva Booking',       'Operations',    2),
    ('laddu_booking',     'Laddu Booking',      'Operations',    3),
    ('goshala_tickets',   'Goshala Tickets',    'Operations',    4),
    ('advance_booking',   'Advance Booking',    'Operations',    5),
    ('lifetime_members',  'Lifetime Members',   'Operations',    6),
    ('seva_master',       'Seva Master',        'Master Data',   7),
    ('reports',           'Reports',            'Reports',       8),
    ('temple_mgmt',       'Temple Management',  'Administration',9),
    ('deity_mgmt',        'Deity Management',   'Administration',10),
    ('user_mgmt',         'User Management',    'Administration',11),
    ('screen_allocation', 'Screen Allocation',  'Administration',12),
    ('counters',          'Counters',           'Administration',13);
END
GO

-- ---- 4. ScreenPermissions for SuperAdmin (all screens, all permissions) ----
DECLARE @SuperAdminRoleId INT;
SELECT @SuperAdminRoleId = RoleId FROM Roles WHERE RoleName = 'SuperAdmin';

IF @SuperAdminRoleId IS NOT NULL
BEGIN
    INSERT INTO ScreenPermissions (RoleId, ScreenId, CanView, CanCreate, CanEdit, CanDelete)
    SELECT @SuperAdminRoleId, s.ScreenId, 1, 1, 1, 1
    FROM Screens s
    WHERE NOT EXISTS (
        SELECT 1 FROM ScreenPermissions sp
        WHERE sp.RoleId = @SuperAdminRoleId AND sp.ScreenId = s.ScreenId
    );
END
GO

-- ---- 5. Temples ----
-- Get the admin user id for CreatedBy
DECLARE @AdminUserId INT;
SELECT @AdminUserId = UserId FROM Users WHERE Username = 'admin';

IF NOT EXISTS (SELECT 1 FROM Temples WHERE TempleName = 'Venkateshwara Swami')
BEGIN
    INSERT INTO Temples (TempleName, Description, IsMainTemple, DisplayOrder, CreatedBy) VALUES
    ('Venkateshwara Swami', 'Main temple - Sri Venkateshwara Swami Temple', 1, 1, @AdminUserId),
    ('General',             'General temple services and common sevas',     0, 2, @AdminUserId),
    ('Dattatreya Swami',    'Sri Dattatreya Swami Temple',                 0, 3, @AdminUserId),
    ('Anjaneya Swami',      'Sri Anjaneya Swami Temple',                   0, 4, @AdminUserId),
    ('Padmavathi Ammavaru', 'Sri Padmavathi Ammavaru Temple',              0, 5, @AdminUserId),
    ('Lord Shiva',          'Lord Shiva Temple',                           0, 6, @AdminUserId),
    ('Ganapathi',           'Sri Ganapathi Temple',                        0, 7, @AdminUserId);
END
GO

-- ---- 6. Deities (each temple gets its temple name as main deity) ----
DECLARE @AdminUserId2 INT;
SELECT @AdminUserId2 = UserId FROM Users WHERE Username = 'admin';

IF NOT EXISTS (SELECT 1 FROM Deities WHERE DeityName = 'Sri Venkateshwara Swami')
BEGIN
    INSERT INTO Deities (TempleId, DeityName, Description, IsMainDeity, DisplayOrder, CreatedBy)
    SELECT t.TempleId,
           CASE t.TempleName
               WHEN 'Venkateshwara Swami' THEN 'Sri Venkateshwara Swami'
               WHEN 'General'             THEN 'General Deity'
               WHEN 'Dattatreya Swami'    THEN 'Sri Dattatreya Swami'
               WHEN 'Anjaneya Swami'      THEN 'Sri Anjaneya Swami'
               WHEN 'Padmavathi Ammavaru' THEN 'Sri Padmavathi Ammavaru'
               WHEN 'Lord Shiva'          THEN 'Lord Shiva'
               WHEN 'Ganapathi'           THEN 'Sri Ganapathi'
           END,
           'Main deity of ' + t.TempleName + ' Temple',
           1,
           1,
           @AdminUserId2
    FROM Temples t;
END
GO

-- ---- 7. SevaCategories ----
IF NOT EXISTS (SELECT 1 FROM SevaCategories WHERE CategoryName = 'Abhishekam')
BEGIN
    INSERT INTO SevaCategories (CategoryName) VALUES
    ('Abhishekam'),
    ('Archana'),
    ('Alankara'),
    ('Kalyanam'),
    ('Homam'),
    ('Pooja'),
    ('Vratam'),
    ('Naivedya'),
    ('Seva'),
    ('Other');
END
GO

-- ---- 8. SevaMaster (all 35 sevas from seed data) ----
DECLARE @AdminUserId3 INT;
SELECT @AdminUserId3 = UserId FROM Users WHERE Username = 'admin';

IF NOT EXISTS (SELECT 1 FROM SevaMaster WHERE SevaName = 'Abhishekam Pradhana' AND TempleId = (SELECT TempleId FROM Temples WHERE TempleName = 'Venkateshwara Swami'))
BEGIN
    -- Venkateshwara Swami sevas (12)
    INSERT INTO SevaMaster (TempleId, DeityId, CategoryId, SevaName, Amount, CreatedBy)
    VALUES
    ((SELECT TempleId FROM Temples WHERE TempleName='Venkateshwara Swami'),
     (SELECT DeityId FROM Deities WHERE DeityName='Sri Venkateshwara Swami'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Abhishekam'),
     'Abhishekam Pradhana', 2500.00, @AdminUserId3),

    ((SELECT TempleId FROM Temples WHERE TempleName='Venkateshwara Swami'),
     (SELECT DeityId FROM Deities WHERE DeityName='Sri Venkateshwara Swami'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Abhishekam'),
     'Abhishekam Samisti', 250.00, @AdminUserId3),

    ((SELECT TempleId FROM Temples WHERE TempleName='Venkateshwara Swami'),
     (SELECT DeityId FROM Deities WHERE DeityName='Sri Venkateshwara Swami'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Alankara'),
     'Vastra Alankara Seva Pure Silk', 42000.00, @AdminUserId3),

    ((SELECT TempleId FROM Temples WHERE TempleName='Venkateshwara Swami'),
     (SELECT DeityId FROM Deities WHERE DeityName='Sri Venkateshwara Swami'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Alankara'),
     'Vastra Alankara Seva Cotton', 800.00, @AdminUserId3),

    ((SELECT TempleId FROM Temples WHERE TempleName='Venkateshwara Swami'),
     (SELECT DeityId FROM Deities WHERE DeityName='Sri Venkateshwara Swami'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Naivedya'),
     'Naivedya Seva', 1100.00, @AdminUserId3),

    ((SELECT TempleId FROM Temples WHERE TempleName='Venkateshwara Swami'),
     (SELECT DeityId FROM Deities WHERE DeityName='Sri Venkateshwara Swami'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Archana'),
     'Pradhana Archana', 100.00, @AdminUserId3),

    ((SELECT TempleId FROM Temples WHERE TempleName='Venkateshwara Swami'),
     (SELECT DeityId FROM Deities WHERE DeityName='Sri Venkateshwara Swami'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Archana'),
     'Samisti Archana', 30.00, @AdminUserId3),

    ((SELECT TempleId FROM Temples WHERE TempleName='Venkateshwara Swami'),
     (SELECT DeityId FROM Deities WHERE DeityName='Sri Venkateshwara Swami'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Kalyanam'),
     'Kalyanam Pradhana', 5000.00, @AdminUserId3),

    ((SELECT TempleId FROM Temples WHERE TempleName='Venkateshwara Swami'),
     (SELECT DeityId FROM Deities WHERE DeityName='Sri Venkateshwara Swami'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Kalyanam'),
     'Kalyanam Samisti', 500.00, @AdminUserId3),

    ((SELECT TempleId FROM Temples WHERE TempleName='Venkateshwara Swami'),
     (SELECT DeityId FROM Deities WHERE DeityName='Sri Venkateshwara Swami'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Alankara'),
     'Chandana Alankara Seva Pradhana', 2500.00, @AdminUserId3),

    ((SELECT TempleId FROM Temples WHERE TempleName='Venkateshwara Swami'),
     (SELECT DeityId FROM Deities WHERE DeityName='Sri Venkateshwara Swami'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Other'),
     'Ekanta Seva', 100.00, @AdminUserId3),

    ((SELECT TempleId FROM Temples WHERE TempleName='Venkateshwara Swami'),
     (SELECT DeityId FROM Deities WHERE DeityName='Sri Venkateshwara Swami'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Archana'),
     'Sahasranama Archana', 1100.00, @AdminUserId3);

    -- General sevas (5)
    INSERT INTO SevaMaster (TempleId, DeityId, CategoryId, SevaName, Amount, CreatedBy)
    VALUES
    ((SELECT TempleId FROM Temples WHERE TempleName='General'),
     (SELECT DeityId FROM Deities WHERE DeityName='General Deity'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Abhishekam'),
     'Bhoovaraha Swami Abhishekam', 500.00, @AdminUserId3),

    ((SELECT TempleId FROM Temples WHERE TempleName='General'),
     (SELECT DeityId FROM Deities WHERE DeityName='General Deity'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Vratam'),
     'Satyanarayana Swami Vratam Pradhana', 5000.00, @AdminUserId3),

    ((SELECT TempleId FROM Temples WHERE TempleName='General'),
     (SELECT DeityId FROM Deities WHERE DeityName='General Deity'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Vratam'),
     'Satyanarayana Swami Vratam Samisti', 500.00, @AdminUserId3),

    ((SELECT TempleId FROM Temples WHERE TempleName='General'),
     (SELECT DeityId FROM Deities WHERE DeityName='General Deity'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Pooja'),
     'Vahana Pooja 2 Wheeler', 500.00, @AdminUserId3),

    ((SELECT TempleId FROM Temples WHERE TempleName='General'),
     (SELECT DeityId FROM Deities WHERE DeityName='General Deity'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Pooja'),
     'Vahana Pooja 4 Wheeler', 1000.00, @AdminUserId3);

    -- Dattatreya Swami sevas (3)
    INSERT INTO SevaMaster (TempleId, DeityId, CategoryId, SevaName, Amount, CreatedBy)
    VALUES
    ((SELECT TempleId FROM Temples WHERE TempleName='Dattatreya Swami'),
     (SELECT DeityId FROM Deities WHERE DeityName='Sri Dattatreya Swami'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Abhishekam'),
     'Abhishekam Pradhana', 1100.00, @AdminUserId3),

    ((SELECT TempleId FROM Temples WHERE TempleName='Dattatreya Swami'),
     (SELECT DeityId FROM Deities WHERE DeityName='Sri Dattatreya Swami'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Vratam'),
     'Anagha Vratam Pradhana', 1100.00, @AdminUserId3),

    ((SELECT TempleId FROM Temples WHERE TempleName='Dattatreya Swami'),
     (SELECT DeityId FROM Deities WHERE DeityName='Sri Dattatreya Swami'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Vratam'),
     'Anagha Vratam Samisti', 150.00, @AdminUserId3);

    -- Anjaneya Swami sevas (2)
    INSERT INTO SevaMaster (TempleId, DeityId, CategoryId, SevaName, Amount, CreatedBy)
    VALUES
    ((SELECT TempleId FROM Temples WHERE TempleName='Anjaneya Swami'),
     (SELECT DeityId FROM Deities WHERE DeityName='Sri Anjaneya Swami'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Abhishekam'),
     'Abhishekam Pradhana', 1100.00, @AdminUserId3),

    ((SELECT TempleId FROM Temples WHERE TempleName='Anjaneya Swami'),
     (SELECT DeityId FROM Deities WHERE DeityName='Sri Anjaneya Swami'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Seva'),
     'Vadamalasamarpa Seva', 250.00, @AdminUserId3);

    -- Padmavathi Ammavaru sevas (3)
    INSERT INTO SevaMaster (TempleId, DeityId, CategoryId, SevaName, Amount, CreatedBy)
    VALUES
    ((SELECT TempleId FROM Temples WHERE TempleName='Padmavathi Ammavaru'),
     (SELECT DeityId FROM Deities WHERE DeityName='Sri Padmavathi Ammavaru'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Abhishekam'),
     'Abhishekam Seva Pradhana', 1100.00, @AdminUserId3),

    ((SELECT TempleId FROM Temples WHERE TempleName='Padmavathi Ammavaru'),
     (SELECT DeityId FROM Deities WHERE DeityName='Sri Padmavathi Ammavaru'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Archana'),
     'Archana', 30.00, @AdminUserId3),

    ((SELECT TempleId FROM Temples WHERE TempleName='Padmavathi Ammavaru'),
     (SELECT DeityId FROM Deities WHERE DeityName='Sri Padmavathi Ammavaru'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Archana'),
     'Kumkumarchana', 100.00, @AdminUserId3);

    -- Lord Shiva sevas (2)
    INSERT INTO SevaMaster (TempleId, DeityId, CategoryId, SevaName, Amount, CreatedBy)
    VALUES
    ((SELECT TempleId FROM Temples WHERE TempleName='Lord Shiva'),
     (SELECT DeityId FROM Deities WHERE DeityName='Lord Shiva'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Abhishekam'),
     'Rudhrabhisekam Pradhana', 2500.00, @AdminUserId3),

    ((SELECT TempleId FROM Temples WHERE TempleName='Lord Shiva'),
     (SELECT DeityId FROM Deities WHERE DeityName='Lord Shiva'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Kalyanam'),
     'Shiva Parvathi Kalyanam Pradhana', 5000.00, @AdminUserId3);

    -- Ganapathi sevas (3)
    INSERT INTO SevaMaster (TempleId, DeityId, CategoryId, SevaName, Amount, CreatedBy)
    VALUES
    ((SELECT TempleId FROM Temples WHERE TempleName='Ganapathi'),
     (SELECT DeityId FROM Deities WHERE DeityName='Sri Ganapathi'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Abhishekam'),
     'Abhishekam Pradhana', 1100.00, @AdminUserId3),

    ((SELECT TempleId FROM Temples WHERE TempleName='Ganapathi'),
     (SELECT DeityId FROM Deities WHERE DeityName='Sri Ganapathi'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Pooja'),
     'Sankashtachaturthi Pradhana', 1100.00, @AdminUserId3),

    ((SELECT TempleId FROM Temples WHERE TempleName='Ganapathi'),
     (SELECT DeityId FROM Deities WHERE DeityName='Sri Ganapathi'),
     (SELECT CategoryId FROM SevaCategories WHERE CategoryName='Homam'),
     'Homam Pradhana', 1100.00, @AdminUserId3);
END
GO

-- ---- 9. Counters ----
IF NOT EXISTS (SELECT 1 FROM Counters WHERE CounterName = 'Seva Counter 01')
BEGIN
    INSERT INTO Counters (CounterName, Location, IsActive) VALUES
    ('Seva Counter 01', 'Main Hall - Counter 1', 1),
    ('Seva Counter 02', 'Main Hall - Counter 2', 1);
END
GO

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================
PRINT '========================================';
PRINT 'Database initialization complete!';
PRINT '========================================';

PRINT '';
PRINT 'Table row counts:';

DECLARE @count INT;

SELECT @count = COUNT(*) FROM Roles;        PRINT 'Roles:             ' + CAST(@count AS VARCHAR);
SELECT @count = COUNT(*) FROM Users;        PRINT 'Users:             ' + CAST(@count AS VARCHAR);
SELECT @count = COUNT(*) FROM Screens;      PRINT 'Screens:           ' + CAST(@count AS VARCHAR);
SELECT @count = COUNT(*) FROM ScreenPermissions; PRINT 'ScreenPermissions: ' + CAST(@count AS VARCHAR);
SELECT @count = COUNT(*) FROM Temples;      PRINT 'Temples:           ' + CAST(@count AS VARCHAR);
SELECT @count = COUNT(*) FROM Deities;      PRINT 'Deities:           ' + CAST(@count AS VARCHAR);
SELECT @count = COUNT(*) FROM SevaCategories; PRINT 'SevaCategories:    ' + CAST(@count AS VARCHAR);
SELECT @count = COUNT(*) FROM SevaMaster;   PRINT 'SevaMaster:        ' + CAST(@count AS VARCHAR);
SELECT @count = COUNT(*) FROM Counters;     PRINT 'Counters:          ' + CAST(@count AS VARCHAR);
SELECT @count = COUNT(*) FROM Bookings;     PRINT 'Bookings:          ' + CAST(@count AS VARCHAR);
SELECT @count = COUNT(*) FROM BookingItems; PRINT 'BookingItems:      ' + CAST(@count AS VARCHAR);
SELECT @count = COUNT(*) FROM LifetimeMembers; PRINT 'LifetimeMembers:   ' + CAST(@count AS VARCHAR);
SELECT @count = COUNT(*) FROM AuditLog;     PRINT 'AuditLog:          ' + CAST(@count AS VARCHAR);

PRINT '';
PRINT 'Stored Procedures:';
IF OBJECT_ID('sp_GenerateBookingNumber','P') IS NOT NULL PRINT '  sp_GenerateBookingNumber: OK';
IF OBJECT_ID('sp_GenerateTokenNumber','P') IS NOT NULL   PRINT '  sp_GenerateTokenNumber:   OK';
PRINT '';
PRINT 'All done!';
GO
