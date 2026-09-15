type Owner = { tool:"read_note"; path:string; part:string } | { tool:"search_entries" };
/** Per-answer transport aliases only. The original reader still validates scope,
 * filters, offsets and source version after the issued cursor is restored. */
export class AnswerCursorAliases {
  private issued=new Map<string,{owner:Owner;raw:string}>();
  private issue(raw:string,owner:Owner):string {
    for(const [alias,value] of this.issued)if(value.raw===raw&&JSON.stringify(value.owner)===JSON.stringify(owner))return alias;
    if(this.issued.size>=256)throw new Error("Turn cursor budget exhausted; restart the read");
    const alias=`cursor_${this.issued.size+1}`;this.issued.set(alias,{owner,raw});return alias;
  }
  resolve(alias:string,owner:Owner):string {
    const value=this.issued.get(alias);
    if(!value||JSON.stringify(value.owner)!==JSON.stringify(owner))throw new Error("Unknown cursor or cursor belongs to another source; use an issued nextCursor from this turn");
    return value.raw;
  }
  readOwner(path:string,part="body"):Owner{return {tool:"read_note",path,part};}
  searchOwner():Owner{return {tool:"search_entries"};}
  encode(result:string,owner:Owner):string {
    let parsed:unknown;try{parsed=JSON.parse(result);}catch{return result;}
    const visit=(value:any,inherited:Owner):any=>{
      if(Array.isArray(value))return value.map(item=>visit(item,inherited));
      if(!value||typeof value!=="object")return value;
      const scope:Owner=typeof value.readPath==="string"?this.readOwner(value.readPath,value.part??"body"):inherited;
      // Coverage continuations carry their own tool/input boundary.
      if((value.tool==="read_note"||value.tool==="search_entries")&&value.input&&typeof value.input==="object"){
        const own=value.tool==="read_note"?this.readOwner(value.input.path,value.input.part??"body"):this.searchOwner();
        return {...value,input:visit(value.input,own)};
      }
      return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,
        (key==="nextCursor"||key==="cursor")&&typeof item==="string" ? this.issue(item,scope):visit(item,scope)]));
    };
    return JSON.stringify(visit(parsed,owner));
  }
}
