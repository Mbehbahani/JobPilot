$env:PATH = "C:\Users\Mohammad\.bun\bin;" + $env:PATH
Set-Location "D:\AWS\2- JobLab - Kanban\JobPilot"

$email = "moha.behb@gmail.com"

$findUserJson = @'
{"model":"user","where":[{"field":"email","operator":"eq","value":"__EMAIL__"}]}
'@ -replace "__EMAIL__", $email

$user = bun convex run --component betterAuth adapter:findOne $findUserJson
$user

if (-not $user) {
	Write-Host "User not found: $email"
	return
}

$id = $null
$idMatchJs = [regex]::Match($user, "_id:\s*'([^']+)'")
if ($idMatchJs.Success) {
	$id = $idMatchJs.Groups[1].Value
}

if (-not $id) {
	$idMatchJson = [regex]::Match($user, '"_id"\s*:\s*"([^"]+)"')
	if ($idMatchJson.Success) {
		$id = $idMatchJson.Groups[1].Value
	}
}

if (-not $id) {
	throw "Could not parse user _id from CLI output."
}

$deleteAccountsJson = @'
{"input":{"model":"account","where":[{"field":"userId","value":"__USER_ID__"}]},"paginationOpts":{"numItems":100,"cursor":null}}
'@ -replace "__USER_ID__", $id
bun convex run --component betterAuth adapter:deleteMany $deleteAccountsJson

$deleteSessionsJson = @'
{"input":{"model":"session","where":[{"field":"userId","value":"__USER_ID__"}]},"paginationOpts":{"numItems":100,"cursor":null}}
'@ -replace "__USER_ID__", $id
bun convex run --component betterAuth adapter:deleteMany $deleteSessionsJson

$deleteUserJson = @'
{"input":{"model":"user","where":[{"field":"email","value":"__EMAIL__"}]}}
'@ -replace "__EMAIL__", $email
bun convex run --component betterAuth adapter:deleteOne $deleteUserJson

$verifyGoneJson = @'
{"model":"user","where":[{"field":"email","operator":"eq","value":"__EMAIL__"}]}
'@ -replace "__EMAIL__", $email
bun convex run --component betterAuth adapter:findOne $verifyGoneJson
