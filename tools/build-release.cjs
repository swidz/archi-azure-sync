/* Maintainer-only: build a runtime ZIP from a committed revision with Git + Node.js. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),git=(...args)=>cp.execFileSync('git',['-C',root,...args],{encoding:'utf8'});
const ref=process.argv[2] || 'HEAD';
const commit=git('rev-parse','--verify',ref+'^{commit}').trim();
const pkg=JSON.parse(git('show',commit+':package.json'));
if(!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(pkg.version))throw Error('Invalid release version');
const output=path.resolve(process.argv[3] || path.join(root,'work','releases'));
const selected=[
 'README.md','LICENSE','THIRD-PARTY-NOTICES.md',
 'scripts/Sync Azure.ajs','scripts/utils/Apply Azure Appearance.ajs','scripts/utils/Export Azure Inventory.ajs',
 'scripts/utils/Discover Azure Resource Types.ajs','scripts/utils/Manage Azure Specializations.ajs',
 'lib/core.js','lib/azure-client.js','lib/infrastructure.js','lib/entra-applications.js','lib/connections.js',
 'lib/azure-cli.js','lib/azure-cli-java.js','lib/java-runtime.js','lib/archi-adapter.js','lib/app.js',
 'config/specializations.js','config/catalog-provenance.json',
 'assets/icons','assets/terms','assets/icon-index.json','assets/icon-provenance.json',
 'docs/user-manual.md','docs/authentication.md','docs/catalog.md','docs/child-resources.md',
 'docs/entra-applications.md','docs/connections.md','docs/partial-sync.md','docs/infrastructure.md'
];
const entries=git('ls-tree','-r','--name-only',commit,'--',...selected).trim().split('\n');
const files=new Set(entries);
for(const name of selected)if(!files.has(name) && !entries.some(f=>f.startsWith(name+'/')))throw Error('Missing runtime path: '+name);
for(const name of entries){
 if(/(^|\/)(tests|tools|work|node_modules|\.github|\.git|test-results)(\/|$)|(^|\/)package(?:-lock)?\.json$|\.(archimate|log|bak)$/.test(name))throw Error('Development or private file in release: '+name);
 if(/\.(js|ajs)$/.test(name))new vm.Script(git('show',commit+':'+name),{filename:name});
 if(name.startsWith('scripts/'))for(const match of git('show',commit+':'+name).matchAll(/"((?:lib|config)\/[^"\r\n]+)"/g))if(!files.has(match[1]))throw Error('Missing script dependency: '+match[1]);
}
const ctx={};vm.runInNewContext(git('show',commit+':config/specializations.js'),ctx);
for(const row of ctx.AZURE_SPECIALIZATIONS)if(row[2] && !files.has('assets/icons/'+row[2]))throw Error('Missing mapped icon: '+row[2]);
const name='archi-azure-sync-'+pkg.version+'.zip',archive=path.join(output,name);
fs.mkdirSync(output,{recursive:true});
const metadata=JSON.stringify({version:pkg.version,commit,packageType:'Archi runtime'},null,2)+'\n';
git('archive','--format=zip','--prefix=archi-azure-sync/','--add-virtual-file=archi-azure-sync/RELEASE.json:'+metadata,'--output='+archive,commit,'--',...selected);
const sha256=crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
fs.writeFileSync(archive+'.sha256',sha256+'  '+name+'\n');
console.log(JSON.stringify({archive,checksum:archive+'.sha256',version:pkg.version,commit,files:entries.length+1,sha256,bytes:fs.statSync(archive).size},null,2));
