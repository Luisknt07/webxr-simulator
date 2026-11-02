param(
  [Parameter(Mandatory=$true)][string]$Source,
  [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sourceFile = Get-Item -LiteralPath $Source
$targetDirectory = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($targetDirectory) | Out-Null
[IO.Directory]::CreateDirectory((Join-Path $targetDirectory 'media')) | Out-Null
$utf8 = [Text.UTF8Encoding]::new($false)
$wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
$relationshipNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
function Read-EntryXml($zip, [string]$name) {
  $entry = $zip.GetEntry($name)
  if (!$entry) { return $null }
  $reader = [IO.StreamReader]::new($entry.Open())
  try { $document = [Xml.XmlDocument]::new(); $document.PreserveWhitespace = $true; $document.LoadXml($reader.ReadToEnd()); return ,$document }
  finally { $reader.Dispose() }
}
function Node-Path($node) {
  $segments = [Collections.Generic.List[string]]::new()
  while ($node -and $node.NodeType -eq [Xml.XmlNodeType]::Element) {
    $index = 1; $previous = $node.PreviousSibling
    while ($previous) { if ($previous.LocalName -eq $node.LocalName -and $previous.NamespaceURI -eq $node.NamespaceURI) { $index++ }; $previous = $previous.PreviousSibling }
    $segments.Insert(0, $node.Name + '[' + $index + ']'); $node = $node.ParentNode
  }
  return '/' + ($segments -join '/')
}
function Paragraph-Text($node, $namespaces) {
  $builder = [Text.StringBuilder]::new()
  foreach ($run in $node.SelectNodes('.//w:t|.//w:tab|.//w:br|.//w:cr', $namespaces)) {
    if ($run.LocalName -eq 't') { [void]$builder.Append($run.InnerText) }
    elseif ($run.LocalName -eq 'tab') { [void]$builder.Append("`t") }
    else { [void]$builder.Append("`n") }
  }
  return $builder.ToString()
}
$zip = [IO.Compression.ZipFile]::OpenRead($sourceFile.FullName)
try {
  $styleDocument = Read-EntryXml $zip 'word/styles.xml'
  $styleNamespaces = [Xml.XmlNamespaceManager]::new($styleDocument.NameTable); $styleNamespaces.AddNamespace('w', $wordNamespace)
  $styles = @{}
  foreach ($style in $styleDocument.SelectNodes('//w:style', $styleNamespaces)) {
    $id = $style.GetAttribute('styleId', $wordNamespace); $name = $style.SelectSingleNode('./w:name', $styleNamespaces); $outline = $style.SelectSingleNode('./w:pPr/w:outlineLvl', $styleNamespaces)
    $styles[$id] = [ordered]@{name=if($name){$name.GetAttribute('val',$wordNamespace)}else{''}; outline=if($outline){[int]$outline.GetAttribute('val',$wordNamespace)}else{$null}}
  }
  $paragraphs = [Collections.Generic.List[object]]::new(); $tables = [Collections.Generic.List[object]]::new(); $hyperlinks = [Collections.Generic.List[object]]::new(); $images = [Collections.Generic.List[object]]::new(); $parts = [Collections.Generic.List[object]]::new()
  $contentParts = @($zip.Entries | Where-Object {$_.FullName -match '^word/(document|footnotes|endnotes|comments|header\d+|footer\d+)\.xml$'})
  foreach ($entry in $contentParts) {
    $part = $entry.FullName; $document = Read-EntryXml $zip $part
    $ns = [Xml.XmlNamespaceManager]::new($document.NameTable); $ns.AddNamespace('w',$wordNamespace); $ns.AddNamespace('r',$relationshipNamespace); $ns.AddNamespace('a','http://schemas.openxmlformats.org/drawingml/2006/main'); $ns.AddNamespace('wp','http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'); $ns.AddNamespace('v','urn:schemas-microsoft-com:vml')
    $relationships = @{}; $relationPart = [IO.Path]::GetDirectoryName($part).Replace('\','/') + '/_rels/' + [IO.Path]::GetFileName($part) + '.rels'
    $relationDocument = Read-EntryXml $zip $relationPart
    if ($relationDocument) { foreach ($rel in $relationDocument.DocumentElement.ChildNodes) { $relationships[$rel.GetAttribute('Id')] = [ordered]@{target=$rel.GetAttribute('Target');mode=$rel.GetAttribute('TargetMode');type=$rel.GetAttribute('Type')} } }
    $partId = [IO.Path]::GetFileNameWithoutExtension($part); $lookup = @{}; $paragraphIndex = 0
    foreach ($paragraph in $document.SelectNodes('//w:p',$ns)) {
      $paragraphIndex++; $id = $partId + '-p' + $paragraphIndex.ToString('0000'); $locator = Node-Path $paragraph; $lookup[$locator] = $id
      $styleNode = $paragraph.SelectSingleNode('./w:pPr/w:pStyle',$ns); $styleId = if($styleNode){$styleNode.GetAttribute('val',$wordNamespace)}else{''}; $style = $styles[$styleId]
      $outlineNode = $paragraph.SelectSingleNode('./w:pPr/w:outlineLvl',$ns); $outline = if($outlineNode){[int]$outlineNode.GetAttribute('val',$wordNamespace)}elseif($style){$style.outline}else{$null}
      $level = if($null -ne $outline -and $outline -lt 9){$outline+1}elseif($styleId -match '^Heading([1-9])$'){[int]$Matches[1]}else{$null}
      $paragraphImages = [Collections.Generic.List[object]]::new(); $paragraphLinks = [Collections.Generic.List[object]]::new()
      foreach ($link in $paragraph.SelectNodes('.//w:hyperlink',$ns)) {
        $rid=$link.GetAttribute('id',$relationshipNamespace); $rel=$relationships[$rid]; $record=[ordered]@{id=$partId+'-link'+($hyperlinks.Count+1);paragraphId=$id;part=$part;xpath=(Node-Path $link);text=(Paragraph-Text $link $ns);relationshipId=$rid;anchor=$link.GetAttribute('anchor',$wordNamespace);target=if($rel){$rel.target}else{''};targetMode=if($rel){$rel.mode}else{''}}
        $hyperlinks.Add($record);$paragraphLinks.Add($record.id)
      }
      foreach ($image in $paragraph.SelectNodes('.//a:blip|.//v:imagedata',$ns)) {
        $rid=if($image.LocalName -eq 'blip'){$image.GetAttribute('embed',$relationshipNamespace)}else{$image.GetAttribute('id',$relationshipNamespace)}; $rel=$relationships[$rid]
        $drawing=$image;while($drawing -and $drawing.LocalName -notin @('drawing','pict')){$drawing=$drawing.ParentNode};$description=if($drawing){$drawing.SelectSingleNode('.//wp:docPr',$ns)}else{$null}
        $record=[ordered]@{id=$partId+'-image'+($images.Count+1);paragraphId=$id;part=$part;xpath=(Node-Path $image);relationshipId=$rid;target=if($rel){$rel.target}else{''};name=if($description){$description.GetAttribute('name')}else{''};alt=if($description){$description.GetAttribute('descr')}else{''}}
        $images.Add($record);$paragraphImages.Add($record.id)
      }
      $paragraphs.Add([ordered]@{id=$id;part=$part;index=$paragraphIndex;xpath=$locator;style=$styleId;styleName=if($style){$style.name}else{''};headingLevel=$level;text=(Paragraph-Text $paragraph $ns);fieldInstructions=@($paragraph.SelectNodes('.//w:instrText',$ns)|ForEach-Object{$_.InnerText});hyperlinkIds=@($paragraphLinks);imageIds=@($paragraphImages)})
    }
    $tableIndex=0
    foreach($table in $document.SelectNodes('//w:tbl',$ns)){
      $tableIndex++;$rows=[Collections.Generic.List[object]]::new()
      foreach($row in $table.SelectNodes('./w:tr',$ns)){
        $cells=[Collections.Generic.List[object]]::new()
        foreach($cell in $row.SelectNodes('./w:tc',$ns)){
          $ids=@($cell.SelectNodes('.//w:p',$ns)|ForEach-Object{$lookup[(Node-Path $_)]});$cellText=@($cell.SelectNodes('./w:p',$ns)|ForEach-Object{Paragraph-Text $_ $ns}) -join "`n"
          $cells.Add([ordered]@{xpath=(Node-Path $cell);text=$cellText;paragraphIds=$ids})
        }
        $rows.Add(@($cells))
      }
      $tables.Add([ordered]@{id=$partId+'-table'+$tableIndex.ToString('000');part=$part;xpath=(Node-Path $table);rows=@($rows)})
    }
    $parts.Add([ordered]@{name=$part;paragraphs=$paragraphIndex;tables=$tableIndex;relationships=$relationships})
  }
  $media=[Collections.Generic.List[object]]::new()
  foreach($entry in $zip.Entries|Where-Object{$_.FullName.StartsWith('word/media/')}){
    $stream=$entry.Open();$memory=[IO.MemoryStream]::new();try{$stream.CopyTo($memory);$bytes=$memory.ToArray()}finally{$stream.Dispose();$memory.Dispose()}
    $name=[IO.Path]::GetFileName($entry.FullName);[IO.File]::WriteAllBytes((Join-Path (Join-Path $targetDirectory 'media') $name),$bytes)
    $width=$null;$height=$null;if($name -match '\.png$' -and $bytes.Length -ge 24){$width=($bytes[16]*16777216)+($bytes[17]*65536)+($bytes[18]*256)+$bytes[19];$height=($bytes[20]*16777216)+($bytes[21]*65536)+($bytes[22]*256)+$bytes[23]}
    $media.Add([ordered]@{part=$entry.FullName;file='media/'+$name;bytes=$bytes.Length;sha256=([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes)).Replace('-','').ToLowerInvariant());width=$width;height=$height})
  }
  $app = Read-EntryXml $zip 'docProps/app.xml';$core=Read-EntryXml $zip 'docProps/core.xml'
  $result=[ordered]@{format='smarttwin.docx-ooxml-extraction';version=1;source=[ordered]@{filename=$sourceFile.Name;bytes=$sourceFile.Length;sha256=(Get-FileHash -LiteralPath $sourceFile.FullName -Algorithm SHA256).Hash.ToLower();lastWriteUtc=$sourceFile.LastWriteTimeUtc.ToString('o');originalModified=$false;embeddedInstructionsAreData=$true};packageEntries=@($zip.Entries|ForEach-Object{[ordered]@{name=$_.FullName;bytes=$_.Length;compressedBytes=$_.CompressedLength}});properties=[ordered]@{app=if($app){$app.OuterXml}else{''};core=if($core){$core.OuterXml}else{''}};counts=[ordered]@{paragraphs=$paragraphs.Count;nonemptyParagraphs=@($paragraphs|Where-Object{$_.text}).Count;headings=@($paragraphs|Where-Object{$null -ne $_.headingLevel}).Count;tables=$tables.Count;hyperlinks=$hyperlinks.Count;imageReferences=$images.Count;media=$media.Count};parts=@($parts);paragraphs=@($paragraphs);tables=@($tables);hyperlinks=@($hyperlinks);images=@($images);media=@($media)}
  [IO.File]::WriteAllText((Join-Path $targetDirectory 'source-extraction.json'),($result|ConvertTo-Json -Depth 35),$utf8)
  $transcript=@($paragraphs|ForEach-Object{'['+$_.id+'] '+$_.text}) -join "`n"
  [IO.File]::WriteAllText((Join-Path $targetDirectory 'source-paragraphs.txt'),$transcript,$utf8)
  $result.counts|ConvertTo-Json -Compress
} finally {$zip.Dispose()}
