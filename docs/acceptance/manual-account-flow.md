# Manually test signup, login and password recovery

Open **<http://127.0.0.1:3400/login>**. This is the separate local account-review installation. Your existing installations and histories on other ports have not been changed.

Use a normal browser window for the administrator and a private/incognito window for the invited person. This lets you switch between both roles without overwriting the other person's session.

| Account                | Login ID                                    | Password                                        |
| ---------------------- | ------------------------------------------- | ----------------------------------------------- |
| Initial administrator  | `admin`                                     | `deterministic-test-password-only`              |
| Person you will create | Choose `manual.tester` or another unused ID | Choose your own password with 12–128 characters |

Only use the administrator password above in this disposable local installation. Existing test accounts may appear in Users; choose an unused login ID for your own walkthrough.

## 1. Sign in as the administrator

1. Open the URL above in the normal window.
2. Enter `admin` and deliberately enter a wrong password once. Click **Sign in**. Expect “The login ID or password is incorrect.” The page stays on sign-in.
3. Enter the correct administrator password. Click **Show**, confirm you can see it, then **Hide**.
4. Click **Sign in**. Expect the Skill workbench and a **Users** navigation entry. Refresh once: you should remain signed in.

Do not deliberately lock the only administrator account. Use the new operator for lockout testing later.

## 2. Invite a person

5. Open **Users**. Under **Invite someone**, enter `Manual tester` as the invitation name. Leave the role as **Operator**.
6. Click **Create signup link**. Expect a private account link and its expiry date. It can be used once within seven days.
7. Click **Copy link**, or select the field and copy it manually. Keep this link somewhere private for the reuse check below. It cannot be recovered from the server after refreshing; create another if it is lost.

The link grants the selected role to whoever uses it. Share it directly with the intended person. No email is sent by this installation.

## 3. Sign up in a separate window

8. Open the copied link in the private/incognito window. Expect **Create your account** and an invitation code already supplied by the link.
9. Enter your display name and an unused login ID, such as `manual.tester`. IDs allow letters, numbers, periods, underscores and hyphens. Uppercase IDs are normalized to lowercase.
10. Enter a password of at least 12 characters. Enter a different confirmation and click **Create account**. Expect “Passwords do not match.” No account should be created.
11. Correct the confirmation and submit again. Expect **Your account is ready** and the normalized login ID. The invitation is now consumed.
12. Click **Continue to sign in**. Expect your login ID to be filled. Enter the password you chose and sign in. Expect the workbench.

If the ID is already taken, choose another. A duplicate-ID rejection does not consume the invitation.

## 4. Verify member access

13. Refresh the member window. You should stay signed in. **Users** and **Diagnostics** administrator navigation should be absent.
14. Enter `http://127.0.0.1:3400/users` in the member window. Expect a redirect to the Skill page. In a new signed-out private session, opening `/skill` should redirect to login.
15. Click your display name / **Your account** in the navigation footer, or open <http://127.0.0.1:3400/account>. Expect your own display name, login ID and Operator role.

Everyone admitted to this private installation shares the Skill workspace. Operator does not mean a separate tenant. Users never choose their own administrator role during signup.

## 5. Change your own password

16. On **Your account**, enter a wrong current password, a valid new password and its matching confirmation. Submit. Expect “Your current password is incorrect.”
17. Enter the correct current password and submit again. Expect a return to login with “Password updated.” Every prior session for this account is revoked.
18. Try the old password once: expect rejection. Sign in with the new one: expect success.
19. Click **Sign out**. Expect login. Open `/skill` again: expect login rather than the protected page.

## 6. Recover a forgotten password

20. On login, click **Forgot password?**. Expect an explanation of administrator-assisted recovery, with no claim that an email has been sent. If you forgot your login ID, the administrator can find it by display name in Users.
21. In the administrator window, refresh **Users**, expand **Help someone reset their password**, choose your new account and click **Create reset link**.
22. Copy the new link and open it in the member window. It expires in one hour. Enter a new password and matching confirmation; click **Set new password**.
23. Expect **Password updated**. Continue to sign in and use the new password. Previously open member sessions should require sign-in again.
24. Reopen the same reset link and try submitting again. Expect an invalid/expired/used/revoked-link error. Creating a replacement reset link also revokes the previous one.

## 7. Check invitation reuse and revocation

25. Reopen the already-used signup link. Submit with another unused login ID and valid passwords. Expect a used-link error; a second account must not appear.
26. In Users, create an invitation named `Revocation test`. Copy it, then expand **Issued links** and choose **Revoke** on that invitation. Open it in a private window and submit: expect rejection.
27. Visit <http://127.0.0.1:3400/signup> without a link. Expect instructions to obtain an invitation and a disabled **Create account** button until a code is supplied.

Expired links are checked against the database clock. Their automated acceptance tests move only synthetic test records into the past; there is no browser control that alters expiry for a real invitation.

## 8. Check temporary-password onboarding

28. As administrator, use **Create an account with a temporary password**. Create another operator with an unused login ID and a temporary password.
29. Sign in as that person in a private window. Expect **Your account** with instructions to replace the temporary password. Opening `/skill` should return to this step.
30. Enter the temporary password as **Current password**, choose a different personal password, and submit. Sign in again with the personal password. The workbench should now be available.

Administrator password resets in a user's existing account row also require a personal password change. Signup and reset links let the person choose their password directly.

## 9. Check administrator controls and lockout

31. While the member is signed in, use the administrator window to **Deactivate** that member. Refresh the member window: expect login. Their correct password should now be rejected.
32. **Reactivate** the member, then sign in again. Expect access restored. Existing revoked sessions remain revoked.
33. Optionally promote this disposable member to administrator, sign in again and check that Users appears. Demote them using the original administrator; their previous session should stop working. Do not use the only administrator for this experiment.
34. As the operator, sign out and enter a wrong password five times. The following attempt should say sign-in is temporarily locked. Wait 15 minutes or complete a new administrator-issued password reset link; recovery should clear the lockout.

The API prevents administrators from deactivating/demoting their own account and preserves an active administrator. No permanent password or login-token secrets appear in the user list.

## 10. Check keyboard, mobile and connection errors

35. On sign-in, use Tab from **Login ID** to **Password**, **Show**, and **Sign in**. All controls should have visible focus and work without a mouse. Repeat signup using a password manager/paste.
36. Narrow the browser to about 390 pixels. Forms should remain readable without horizontal page scrolling. The workbench navigation remains available above the content on mobile.
37. With login already loaded, use the browser developer tools to set the network Offline, then submit. Expect a recoverable connection error, with the form retained. Return Online and submit again.
38. Repeat Offline while clicking **Sign out**. The app must not pretend sign-out completed. Return Online and retry; then verify a protected page requires login.

## Continue into SkillEd

After member sign-in you can upload a Skill, approve coverage, generate an eval, run it, review a proposed update, verify and explicitly activate it. This installation's worker uses **demo evidence** so the application journey is deterministic. Account signup/login is real application authentication, but it does not authenticate Codex or resolve the separately documented execution-readiness gate.

## Starting and upgrading the review installation

```sh
COMPOSE_DISABLE_ENV_FILE=true docker compose -p skilled-account-review -f compose.test.yaml -f compose.accounts.yaml up -d --build
COMPOSE_DISABLE_ENV_FILE=true COMPOSE_FILE=compose.test.yaml:compose.accounts.yaml COMPOSE_PROJECT_NAME=skilled-account-review SKILLED_BASE_URL=http://127.0.0.1:3400 ./scripts/verify-stack.sh --demo
```

Use the initial administrator credentials above. Do not run a command that removes volumes; existing test data persists across restarts. Production/Render deployment must run migration 006 and role provisioning with migration credentials before using the new image. Only the web runtime receives account-token permissions; the controller does not.

Passwords now written by this version use scrypt. Existing bcrypt accounts continue to sign in on the new image. An older web image without scrypt support cannot verify newly written scrypt passwords, so an auth rollback must retain this compatibility code. Pending signup/reset links are intentionally excluded from history migration and must be reissued after import. Bootstrap environment passwords do not overwrite existing administrator passwords.

Invitation signup has no SMTP dependency. Recovering the sole administrator after all its sessions/passwords are lost requires an authorized database/operator recovery procedure; another administrator should normally supply a reset link. This flow does not create unrestricted public customer signup.
