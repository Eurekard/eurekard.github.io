# Security Specification: Eurekard

## 1. Data Invariants
- A `Card` must be owned by the user whose UID matches the document ID.
- A `Response` can be created by anyone, but can only be read/updated by the card owner.
- A `User` profile must be created with a unique username that exists in the `usernames` collection.
- Timestamps must be valid server timestamps.

## 2. The "Dirty Dozen" Payloads (Red Team Tests)

### Payload 1: Unauthorized Profile Write
Attempt to update another user's profile info.
`patch /users/attacker-uid { name: 'I hacked you' }` -> **DENIED**

### Payload 2: Username Spoofing
Attempt to create a username mapping for a UID that isn't yours.
`set /usernames/target_user { uid: 'attacker-uid' }` -> **DENIED**

### Payload 3: Response Scraping
Attempt to list responses for a card you don't own.
`list /cards/target-uid/responses` -> **DENIED**

### Payload 4: Ghost Field Injection
Attempt to add an `isAdmin` field to your own user profile.
`patch /users/my-uid { isAdmin: true }` -> **DENIED**

### Payload 5: Response Tampering
Attempt to update a response message left by someone else.
`patch /cards/target-uid/responses/msg-id { message: 'changed' }` -> **DENIED**

### Payload 6: Card Ownership Theft
Attempt to change the `uid` field inside a Card document.
`patch /cards/my-uid { uid: 'someone-else' }` -> **DENIED**

### Payload 7: Large Payload Attack
Inject a 1MB string into a username field.
`set /usernames/long_string_...` -> **DENIED**

### Payload 8: Immutable Field Overwrite
Attempt to change your `createdAt` date.
`patch /users/my-uid { createdAt: '2000-01-01' }` -> **DENIED**

### Payload 9: Invalid Status Injection
Set a response status to `verified_by_boss`.
`patch /cards/my-uid/responses/msg-id { status: 'verified_by_boss' }` -> **DENIED**

### Payload 10: Parent-less Response
Create a response for a non-existent card. (Rules should ideally check card existence).

### Payload 11: Bulk Read
Query all users' emails.
`list /users` -> **DENIED** (unless specific filters applied, but here all list is denied by default)

### Payload 12: Anonymous Box Spam
Submit a 10MB message to an anonymous box.
`create /cards/target-uid/responses { message: '...' }` -> **DENIED** (size check)
