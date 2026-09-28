/* Native SWT multi-selection dialogs. SWT ships with Archi on Windows, macOS and Linux. */
var AzureSelection = (function() {
    "use strict";
    var C = typeof AzureCore !== "undefined" ? AzureCore : require("./core.js");
    function typeRows(mapping, existing, options) {
        var types = Object.create(null);
        Object.keys(mapping).forEach(function(k) { types[k] = mapping[k].azureType; });
        ["Microsoft.Resources/subscriptions", "Microsoft.Resources/resourceGroups", "Microsoft.ServiceBus/namespaces/queues", "Microsoft.ServiceBus/namespaces/topics", "Microsoft.Web/sites/functions", "Microsoft.Graph/applications", "Microsoft.Network/virtualNetworks/subnets"].forEach(function(t) { types[C.lower(t)] = t; });
        existing.forEach(function(e) { var t = e.properties["Azure-ObjectType"]; if (t) types[C.lower(t)] = t; });
        var hints = {"microsoft.web/sites":"Function Apps and Web Apps", "microsoft.web/sites/functions":"Individual Azure Functions", "microsoft.servicebus/namespaces/queues":"Service Bus queues", "microsoft.servicebus/namespaces/topics":"Service Bus topics", "microsoft.graph/applications":"Entra app registrations (tenant-wide)"};
        return Object.keys(types).sort().filter(function(k) {
            return (options.includeEntraApplications || !C.isEntraApplication(k)) && (options.enrichInfrastructure || k !== "microsoft.network/virtualnetworks/subnets");
        }).map(function(k) { return {id:k, label:types[k] + (hints[k] ? " — " + hints[k] : "")}; });
    }
    // Filtering changes only visibility, never the checked state of hidden rows.
    function state(rows, initial) {
        var checked = Object.create(null), valid = Object.create(null);
        rows.forEach(function(r) { C.assert(!valid[r.id], "Duplicate selection row."); valid[r.id] = true; });
        (initial || []).forEach(function(id) { if (valid[id]) checked[id] = true; });
        return {
            visible:function(query) { var words = C.lower(query).trim().split(/\s+/).filter(Boolean); return rows.filter(function(r) { return words.every(function(w) { return C.lower(r.label).indexOf(w) >= 0; }); }); },
            check:function(id, value) { C.assert(valid[id], "Unknown selection row."); if (value) checked[id] = true; else delete checked[id]; },
            has:function(id) { return !!checked[id]; }, clear:function() { checked = Object.create(null); },
            ids:function() { return rows.filter(function(r) { return !!checked[r.id]; }).map(function(r) { return r.id; }); }
        };
    }
    function choose(title, message, rows, initial, allowAll) {
        var SWT = Java.type("org.eclipse.swt.SWT"), Shell = Java.type("org.eclipse.swt.widgets.Shell");
        var Label = Java.type("org.eclipse.swt.widgets.Label"), Text = Java.type("org.eclipse.swt.widgets.Text");
        var Table = Java.type("org.eclipse.swt.widgets.Table"), Item = Java.type("org.eclipse.swt.widgets.TableItem");
        var Button = Java.type("org.eclipse.swt.widgets.Button"), Composite = Java.type("org.eclipse.swt.widgets.Composite");
        var GridLayout = Java.type("org.eclipse.swt.layout.GridLayout"), GridData = Java.type("org.eclipse.swt.layout.GridData");
        var display = Java.type("org.eclipse.swt.widgets.Display").getCurrent();
        var parent = typeof shell !== "undefined" && shell ? shell : display.getActiveShell();
        var dialog = new Shell(parent || display, SWT.DIALOG_TRIM | SWT.APPLICATION_MODAL | SWT.RESIZE), result = null;
        var selected = state(rows, initial), visible = [], all = null;
        dialog.setText(title); dialog.setLayout(new GridLayout(1, false));
        var intro = new Label(dialog, SWT.WRAP); intro.setText(message); intro.setLayoutData(new GridData(SWT.FILL, SWT.CENTER, true, false));
        if (allowAll) { all = new Button(dialog, SWT.CHECK); all.setText("All Azure types (including types not in this catalog)"); all.setSelection(initial === null); }
        var search = new Text(dialog, SWT.SEARCH | SWT.ICON_SEARCH | SWT.CANCEL | SWT.BORDER); search.setMessage("Filter by name or type..."); search.setLayoutData(new GridData(SWT.FILL, SWT.CENTER, true, false));
        var table = new Table(dialog, SWT.CHECK | SWT.BORDER | SWT.V_SCROLL | SWT.H_SCROLL | SWT.FULL_SELECTION);
        table.setLayoutData(new GridData(SWT.FILL, SWT.FILL, true, true));
        var status = new Label(dialog, SWT.NONE); status.setLayoutData(new GridData(SWT.FILL, SWT.CENTER, true, false));
        var bar = new Composite(dialog, SWT.NONE); bar.setLayout(new GridLayout(4, false)); bar.setLayoutData(new GridData(SWT.FILL, SWT.CENTER, true, false));
        function button(label, fn) { var b = new Button(bar, SWT.PUSH); b.setText(label); b.setLayoutData(new GridData(SWT.FILL, SWT.CENTER, true, false)); b.addListener(SWT.Selection, fn); return b; }
        function update() {
            var every = all && all.getSelection(), n = selected.ids().length;
            status.setText((every ? "All types selected" : n + " selected") + " · " + visible.length + " shown / " + rows.length);
            table.setEnabled(!every); ok.setEnabled(!!every || n > 0);
        }
        function render() {
            visible = selected.visible(String(search.getText())); table.setRedraw(false);
            try { table.removeAll(); visible.forEach(function(r) { var item = new Item(table, SWT.NONE); item.setText(r.label.replace(/[\r\n\t]/g, " ")); item.setData(r.id); item.setChecked(selected.has(r.id)); }); }
            finally { table.setRedraw(true); }
            update();
        }
        button("Select shown", function() { if (all) all.setSelection(false); visible.forEach(function(r) { selected.check(r.id, true); }); render(); });
        button("Clear all", function() { if (all) all.setSelection(false); selected.clear(); render(); });
        var ok = button("Continue", function() { result = {all:!!(all && all.getSelection()), ids:selected.ids()}; dialog.close(); });
        button("Cancel", function() { dialog.close(); });
        search.addListener(SWT.Modify, render);
        table.addListener(SWT.Selection, function(event) { if (event.detail === SWT.CHECK) { selected.check(String(event.item.getData()), event.item.getChecked()); update(); } });
        if (all) all.addListener(SWT.Selection, update);
        dialog.addListener(SWT.Traverse, function(event) { if (event.detail === SWT.TRAVERSE_ESCAPE) { event.doit = false; dialog.close(); } });
        try {
            render(); dialog.setDefaultButton(ok);
            var bounds = dialog.getMonitor().getClientArea(), width = Math.min(1000, bounds.width - 40), height = Math.min(680, bounds.height - 60);
            dialog.setSize(width, height); dialog.setLocation(bounds.x + Math.floor((bounds.width - width) / 2), bounds.y + Math.floor((bounds.height - height) / 2));
            dialog.open(); search.setFocus();
            while (!dialog.isDisposed()) { if (!display.readAndDispatch()) display.sleep(); }
            return result;
        } finally { if (!dialog.isDisposed()) dialog.dispose(); }
    }
    function types(m, mapping, existing, options) {
        var raw = m.prop("Azure-SelectedObjectTypes"), initial = raw ? C.settings({selectedTypes:JSON.parse(String(raw))}).selectedTypes : null;
        var picked = choose("Azure object types", "Select the object types to synchronize. Required parents, resource groups and subscriptions are included. Unselected types and their relationships are preserved. Use Clear all, filter, then tick types or Select shown.", typeRows(mapping, existing, options), initial, true);
        if (!picked) return undefined;
        return picked.all ? null : C.settings({selectedTypes:picked.ids}).selectedTypes;
    }
    function elements(existing) {
        var rows = existing.map(function(e) { var p = e.properties; return {id:e.id, label:e.name + " | " + p["Azure-ObjectType"] + " | " + (p["Azure-SubscriptionName"] || "Entra ID") + " | " + p["Azure-ObjectId"] + " | Archi " + e.id}; }).sort(function(a,b) { return a.label.localeCompare(b.label); });
        var picked = choose("Refresh existing Azure properties", "Only checked, already managed Azure elements will be read. Names, folders, relationships and diagram appearance stay unchanged. Missing or unreadable objects are reported and preserved.", rows, rows.map(function(r) { return r.id; }), false);
        if (!picked) return null;
        return existing.filter(function(e) { return picked.ids.indexOf(e.id) >= 0; });
    }
    return {typeRows:typeRows, state:state, types:types, elements:elements, choose:choose};
}());
if (typeof module !== "undefined") module.exports = AzureSelection;