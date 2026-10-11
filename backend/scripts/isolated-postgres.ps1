$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$localRoot = Join-Path $taskRoot 'tools\postgresql-local'
$localData = Join-Path $taskRoot 'private\loadtest-db'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead((Join-Path $taskRoot 'tools\postgresql.zip'))
try {
  foreach ($entry in $archive.Entries) {
    if ($entry.FullName -match '^pgsql/(bin|share|lib)/' -and $entry.Name) {
      $relative = $entry.FullName.Substring(6).Replace('/', [IO.Path]::DirectorySeparatorChar)
      $target = [IO.Path]::GetFullPath((Join-Path $localRoot $relative))
      if (-not $target.StartsWith($localRoot + [IO.Path]::DirectorySeparatorChar)) { throw 'Invalid archive path' }
      [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
    }
  }
} finally { $archive.Dispose() }
if (-not (Test-Path -LiteralPath (Join-Path $localData 'PG_VERSION'))) {
  & (Join-Path $localRoot 'bin\initdb.exe') -D $localData -U postgres -A trust --encoding=UTF8 --locale=C
  if ($LASTEXITCODE -ne 0) { throw 'Local test database initialization failed' }
  Add-Content -LiteralPath (Join-Path $localData 'postgresql.conf') -Value "`nport = 55432`nlisten_addresses = '127.0.0.1'`nmax_connections = 100`nshared_buffers = '128MB'`n"
}
& (Join-Path $localRoot 'bin\pg_ctl.exe') -D $localData -l (Join-Path $taskRoot 'private\loadtest-postgres.log') start
if ($LASTEXITCODE -ne 0) { throw 'Local test database startup failed; inspect private log' }
Write-Output 'Isolated PostgreSQL ready on 127.0.0.1:55432. No connection to Supabase.'
