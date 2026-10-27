param([Parameter(Mandatory=$true)][string]$JobFile)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.IO.Compression.FileSystem
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$cache = Join-Path $workspace 'data\qa-studio\pbr-downloads'
$output = Join-Path $workspace 'assets\materials\pbr'
if (-not [IO.Path]::GetFullPath($JobFile).StartsWith($cache + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid PBR job boundary.' }
$jobs = Get-Content -LiteralPath $JobFile -Raw | ConvertFrom-Json
$expanded = @()
foreach ($job in $jobs) {
  if ($job.key -notmatch '^[a-z]+$') { throw 'Invalid material key.' }
  if ($job.archive) {
    if (-not [IO.Path]::GetFullPath($job.archive).StartsWith($cache + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid archive boundary.' }
    $zip = [IO.Compression.ZipFile]::OpenRead($job.archive)
    try {
      foreach ($pair in @(@('color','Color'),@('normal','NormalGL'),@('roughness','Roughness'))) {
        $name = $job.assetId + '_1K-JPG_' + $pair[1] + '.jpg'
        $entry = $zip.Entries | Where-Object { $_.Name -eq $name } | Select-Object -First 1
        if (-not $entry -or $entry.Length -gt 10MB) { throw ('Missing bounded PBR image: ' + $name) }
        $inputPath = Join-Path $cache ($job.key + '-' + $pair[0] + '.jpg')
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $inputPath, $true)
        $expanded += @{key=$job.key;channel=$pair[0];input=$inputPath}
      }
    } finally { $zip.Dispose() }
  } else { $expanded += @{key=$job.key;channel=$job.channel;input=$job.input} }
}
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System; using System.Drawing; using System.Drawing.Imaging; using System.Drawing.Drawing2D; using System.Runtime.InteropServices;
public static class IndustrialPBRBake {
 public static double Bake(string input,string output,int edge,bool neutral) {
  using(var source=new Bitmap(input)) using(var image=new Bitmap(edge,edge,PixelFormat.Format24bppRgb)) {
   using(var graphics=Graphics.FromImage(image)){graphics.CompositingQuality=CompositingQuality.HighQuality;graphics.InterpolationMode=InterpolationMode.HighQualityBicubic;graphics.PixelOffsetMode=PixelOffsetMode.HighQuality;graphics.DrawImage(source,0,0,edge,edge);}
   var data=image.LockBits(new Rectangle(0,0,edge,edge),ImageLockMode.ReadWrite,PixelFormat.Format24bppRgb);byte[] pixels=new byte[data.Stride*edge];Marshal.Copy(data.Scan0,pixels,0,pixels.Length);double sum=0;
   for(int y=0;y<edge;y++)for(int x=0;x<edge;x++){int i=y*data.Stride+x*3;sum+=(pixels[i]*.0722+pixels[i+1]*.7152+pixels[i+2]*.2126)/255.0;}
   double mean=sum/(edge*edge);
   if(neutral){for(int y=0;y<edge;y++)for(int x=0;x<edge;x++){int i=y*data.Stride+x*3;double l=(pixels[i]*.0722+pixels[i+1]*.7152+pixels[i+2]*.2126)/255.0;byte v=(byte)Math.Max(160,Math.Min(255,232+(l-Math.Max(.05,mean))*115));pixels[i]=pixels[i+1]=pixels[i+2]=v;}Marshal.Copy(pixels,0,data.Scan0,pixels.Length);}
   image.UnlockBits(data);ImageCodecInfo jpeg=null;foreach(var codec in ImageCodecInfo.GetImageEncoders())if(codec.MimeType=="image/jpeg")jpeg=codec;
   using(var options=new EncoderParameters(1)){options.Param[0]=new EncoderParameter(Encoder.Quality,92L);image.Save(output,jpeg,options);}return mean;
  }
 }
}
'@
$statistics = @{}
foreach ($job in $expanded) {
  $inputPath = [IO.Path]::GetFullPath($job.input)
  if (-not $inputPath.StartsWith($cache + '\', [StringComparison]::OrdinalIgnoreCase) -or $job.channel -notin @('color','normal','roughness')) { throw 'Invalid image job.' }
  foreach ($edge in @(256,512,1024)) {
    $destination = Join-Path $output ($job.key + '-' + $job.channel + '-' + $edge + '.jpg')
    $mean = [IndustrialPBRBake]::Bake($inputPath, $destination, $edge, $false)
    if ($job.channel -eq 'roughness' -and $edge -eq 512) { $statistics[$job.key]=$mean }
    if ($job.channel -eq 'color') { [void][IndustrialPBRBake]::Bake($inputPath, (Join-Path $output ($job.key + '-neutral-' + $edge + '.jpg')), $edge, $true) }
  }
}
$statistics | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $cache 'statistics.json') -Encoding UTF8
