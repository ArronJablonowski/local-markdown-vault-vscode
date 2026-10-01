// Keep native clipboard QA from replacing the user's existing clipboard formats.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

export function pasteboard(operation, payload = '') {
  assert.equal(process.platform, 'darwin', 'The pasteboard helper requires macOS.');
  assert.ok(operation === 'read' || operation === 'write');
  const body = operation === 'read' ? `var result=[]; var items=$.NSPasteboard.generalPasteboard.pasteboardItems; for(var i=0;i<items.count;i++){var item=items.objectAtIndex(i),entry=[];for(var j=0;j<item.types.count;j++){var type=item.types.objectAtIndex(j),data=item.dataForType(type);if(data)entry.push([type.js,data.base64EncodedStringWithOptions(0).js]);}result.push(entry);}JSON.stringify(result);`
    : `var data=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;var text=$.NSString.alloc.initWithDataEncoding(data,$.NSUTF8StringEncoding).js;var items=$.NSMutableArray.alloc.init;JSON.parse(text).forEach(function(entry){var item=$.NSPasteboardItem.alloc.init;entry.forEach(function(pair){if(!item.setDataForType($.NSData.alloc.initWithBase64EncodedStringOptions(pair[1],0),pair[0]))throw Error('Pasteboard data rejected');});items.addObject(item);});var board=$.NSPasteboard.generalPasteboard;board.clearContents;if(items.count&&!board.writeObjects(items))throw Error('Pasteboard items rejected');'restored';`;
  const result = spawnSync('osascript', ['-l', 'JavaScript', '-e', `ObjC.import('AppKit');ObjC.import('Foundation');${body}`], { encoding: 'utf8', input: payload, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, `Pasteboard ${operation} failed: ${result.stderr}`);
  return result.stdout.trim();
}

export function restorePasteboard(snapshot) {
  pasteboard('write', snapshot);
  const canonical = value => JSON.stringify(JSON.parse(value).map(item => item.sort(([a], [b]) => a.localeCompare(b))));
  assert.ok(canonical(pasteboard('read')) === canonical(snapshot), 'Restored pasteboard formats or data differ');
}
