import { DocPage } from "@/components/doc-page";
import { CodeTabs } from "@/components/code-block";
import { Callout, H2, H3 } from "@/components/doc";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Server-rendered apps",
  description: "Add the tracker to Laravel, Rails, Django, Flask, Spring, ASP.NET, Express, Go and Phoenix templates.",
};

export default function ServerRenderedPage() {
  return (
    <DocPage
      href="/docs/frameworks/server-rendered"
      title="Server-rendered apps"
      description="Laravel, Rails, Django, Flask, Spring, ASP.NET, Express, Go and Phoenix: put the tag in your base template."
    >
      <p>
        With a server-rendered app the tracker is just a <code>&lt;script&gt;</code> tag in the layout every page
        extends. Keep the three values in configuration rather than hard-coded, so staging and production can use
        different sites.
      </p>

      <Callout type="tip" title="Turbo, htmx and other partial navigation">
        <p>
          Libraries that swap page content with <code>history.pushState</code> (Rails Turbo, htmx with{" "}
          <code>hx-push-url</code>, Livewire navigate, Inertia) are tracked automatically. Keep the script in the layout
          head so it is not re-added on each swap.
        </p>
      </Callout>

      <H2>1. Add the tag to your layout</H2>
      <CodeTabs
        group="server-framework"
        items={[
          {
            label: "Laravel",
            lang: "blade",
            filename: "resources/views/layouts/app.blade.php",
            code: `<head>
    <meta charset="utf-8">
    <title>@yield('title')</title>

    @production
    <script
        defer
        src="{{ config('services.trackme.script_url') }}"
        data-site="{{ config('services.trackme.site_key') }}"
        data-endpoint="{{ config('services.trackme.endpoint') }}"
    ></script>
    @endproduction
</head>`,
          },
          {
            label: "Rails",
            lang: "erb",
            filename: "app/views/layouts/application.html.erb",
            code: `<head>
  <title><%= yield(:title) %></title>
  <%= csrf_meta_tags %>

  <% if Rails.env.production? %>
    <script
      defer
      src="<%= ENV.fetch("TRACKME_SCRIPT_URL") %>"
      data-site="<%= ENV.fetch("TRACKME_SITE_KEY") %>"
      data-endpoint="<%= ENV.fetch("TRACKME_ENDPOINT") %>"
    ></script>
  <% end %>
</head>`,
          },
          {
            label: "Django",
            lang: "jinja",
            filename: "templates/base.html",
            code: `<head>
  <meta charset="utf-8">
  <title>{% block title %}{% endblock %}</title>

  {% if TRACKME.site_key %}
  <script
    defer
    src="{{ TRACKME.script_url }}"
    data-site="{{ TRACKME.site_key }}"
    data-endpoint="{{ TRACKME.endpoint }}"
  ></script>
  {% endif %}
</head>`,
          },
          {
            label: "Flask",
            lang: "jinja",
            filename: "templates/base.html",
            code: `<head>
  <meta charset="utf-8">
  <title>{% block title %}{% endblock %}</title>

  {% if trackme.site_key %}
  <script
    defer
    src="{{ trackme.script_url }}"
    data-site="{{ trackme.site_key }}"
    data-endpoint="{{ trackme.endpoint }}"
  ></script>
  {% endif %}
</head>`,
          },
          {
            label: "Spring",
            lang: "html",
            filename: "src/main/resources/templates/layout.html",
            code: `<head>
  <meta charset="utf-8" />
  <title th:text="\${title}">Title</title>

  <script
    th:if="\${@environment.getProperty('trackme.site-key')}"
    defer
    th:src="\${@environment.getProperty('trackme.script-url')}"
    th:attr="data-site=\${@environment.getProperty('trackme.site-key')},
             data-endpoint=\${@environment.getProperty('trackme.endpoint')}"
  ></script>
</head>`,
          },
          {
            label: "ASP.NET",
            lang: "razor",
            filename: "Views/Shared/_Layout.cshtml",
            code: `@inject Microsoft.Extensions.Configuration.IConfiguration Config

<head>
    <meta charset="utf-8" />
    <title>@ViewData["Title"]</title>

    @if (!string.IsNullOrEmpty(Config["TrackMe:SiteKey"]))
    {
        <script defer
                src="@Config["TrackMe:ScriptUrl"]"
                data-site="@Config["TrackMe:SiteKey"]"
                data-endpoint="@Config["TrackMe:Endpoint"]"></script>
    }
</head>`,
          },
          {
            label: "Express",
            lang: "html",
            filename: "views/layout.ejs",
            code: `<head>
  <meta charset="utf-8" />
  <title><%= title %></title>

  <% if (trackme.siteKey) { %>
  <script
    defer
    src="<%= trackme.scriptUrl %>"
    data-site="<%= trackme.siteKey %>"
    data-endpoint="<%= trackme.endpoint %>"
  ></script>
  <% } %>
</head>`,
          },
          {
            label: "Go",
            lang: "html",
            filename: "templates/base.html",
            code: `{{ define "base" }}
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>{{ .Title }}</title>
  {{ if .TrackMe.SiteKey }}
  <script
    defer
    src="{{ .TrackMe.ScriptURL }}"
    data-site="{{ .TrackMe.SiteKey }}"
    data-endpoint="{{ .TrackMe.Endpoint }}"
  ></script>
  {{ end }}
</head>
<body>{{ template "content" . }}</body>
</html>
{{ end }}`,
          },
          {
            label: "Phoenix",
            lang: "html",
            filename: "lib/my_app_web/components/layouts/root.html.heex",
            code: `<head>
  <meta charset="utf-8" />
  <.live_title>{assigns[:page_title]}</.live_title>

  <script
    :if={Application.get_env(:my_app, :trackme)[:site_key]}
    defer
    src={Application.get_env(:my_app, :trackme)[:script_url]}
    data-site={Application.get_env(:my_app, :trackme)[:site_key]}
    data-endpoint={Application.get_env(:my_app, :trackme)[:endpoint]}
  >
  </script>
</head>`,
          },
        ]}
      />

      <H2>2. Keep the values in configuration</H2>
      <CodeTabs
        group="server-framework"
        items={[
          {
            label: "Laravel",
            lang: "php",
            filename: "config/services.php",
            code: `'trackme' => [
    'script_url' => env('TRACKME_SCRIPT_URL'),
    'site_key'   => env('TRACKME_SITE_KEY'),
    'endpoint'   => env('TRACKME_ENDPOINT'),
],`,
          },
          {
            label: "Rails",
            lang: "ini",
            filename: ".env.production",
            code: `TRACKME_SCRIPT_URL=https://app.example.com/tracker.js
TRACKME_SITE_KEY=YOUR_SITE_KEY
TRACKME_ENDPOINT=https://ingest.example.com/v1/batch`,
          },
          {
            label: "Django",
            lang: "python",
            filename: "myapp/context_processors.py",
            code: `from django.conf import settings


def trackme(request):
    return {
        "TRACKME": {
            "script_url": settings.TRACKME_SCRIPT_URL,
            "site_key": settings.TRACKME_SITE_KEY,
            "endpoint": settings.TRACKME_ENDPOINT,
        }
    }

# settings.py
#   TEMPLATES[0]["OPTIONS"]["context_processors"] += ["myapp.context_processors.trackme"]
#   TRACKME_SCRIPT_URL = os.environ.get("TRACKME_SCRIPT_URL", "")
#   TRACKME_SITE_KEY = os.environ.get("TRACKME_SITE_KEY", "")
#   TRACKME_ENDPOINT = os.environ.get("TRACKME_ENDPOINT", "")`,
          },
          {
            label: "Flask",
            lang: "python",
            filename: "app.py",
            code: `import os
from flask import Flask

app = Flask(__name__)


@app.context_processor
def inject_trackme():
    return {
        "trackme": {
            "script_url": os.environ.get("TRACKME_SCRIPT_URL", ""),
            "site_key": os.environ.get("TRACKME_SITE_KEY", ""),
            "endpoint": os.environ.get("TRACKME_ENDPOINT", ""),
        }
    }`,
          },
          {
            label: "Spring",
            lang: "yaml",
            filename: "src/main/resources/application.yml",
            code: `trackme:
  script-url: \${TRACKME_SCRIPT_URL:}
  site-key: \${TRACKME_SITE_KEY:}
  endpoint: \${TRACKME_ENDPOINT:}`,
          },
          {
            label: "ASP.NET",
            lang: "json",
            filename: "appsettings.Production.json",
            code: `{
  "TrackMe": {
    "ScriptUrl": "https://app.example.com/tracker.js",
    "SiteKey": "YOUR_SITE_KEY",
    "Endpoint": "https://ingest.example.com/v1/batch"
  }
}`,
          },
          {
            label: "Express",
            lang: "javascript",
            filename: "server.js",
            code: `const express = require("express");
const app = express();

app.set("view engine", "ejs");

app.locals.trackme = {
  scriptUrl: process.env.TRACKME_SCRIPT_URL,
  siteKey: process.env.TRACKME_SITE_KEY,
  endpoint: process.env.TRACKME_ENDPOINT,
};`,
          },
          {
            label: "Go",
            lang: "go",
            filename: "main.go",
            code: `type TrackMe struct {
	ScriptURL string
	SiteKey   string
	Endpoint  string
}

type Page struct {
	Title   string
	TrackMe TrackMe
}

func newPage(title string) Page {
	return Page{
		Title: title,
		TrackMe: TrackMe{
			ScriptURL: os.Getenv("TRACKME_SCRIPT_URL"),
			SiteKey:   os.Getenv("TRACKME_SITE_KEY"),
			Endpoint:  os.Getenv("TRACKME_ENDPOINT"),
		},
	}
}`,
          },
          {
            label: "Phoenix",
            lang: "elixir",
            filename: "config/runtime.exs",
            code: `config :my_app, :trackme,
  script_url: System.get_env("TRACKME_SCRIPT_URL"),
  site_key: System.get_env("TRACKME_SITE_KEY"),
  endpoint: System.get_env("TRACKME_ENDPOINT")`,
          },
        ]}
      />

      <H2>3. Identify signed-in users</H2>
      <p>
        Print the user id into a small script after the layout. Use your framework's JavaScript escaping helper so
        the value cannot break out of the string. The script waits for <code>DOMContentLoaded</code> because the
        tracker loads deferred.
      </p>
      <CodeTabs
        group="server-framework"
        items={[
          {
            label: "Laravel",
            lang: "blade",
            code: `@auth
<script>
  document.addEventListener("DOMContentLoaded", function () {
    window.growth && window.growth.identify(@json((string) auth()->id()));
  });
</script>
@endauth`,
          },
          {
            label: "Rails",
            lang: "erb",
            code: `<% if user_signed_in? %>
<script>
  document.addEventListener("DOMContentLoaded", function () {
    window.growth && window.growth.identify("<%= j current_user.id.to_s %>");
  });
</script>
<% end %>`,
          },
          {
            label: "Django",
            lang: "jinja",
            code: `{% if user.is_authenticated %}
<script>
  document.addEventListener("DOMContentLoaded", function () {
    window.growth && window.growth.identify("{{ user.pk|escapejs }}");
  });
</script>
{% endif %}`,
          },
          {
            label: "Flask",
            lang: "jinja",
            code: `{% if current_user.is_authenticated %}
<script>
  document.addEventListener("DOMContentLoaded", function () {
    window.growth && window.growth.identify({{ current_user.get_id()|tojson }});
  });
</script>
{% endif %}`,
          },
          {
            label: "Spring",
            lang: "html",
            code: `<script th:inline="javascript" sec:authorize="isAuthenticated()">
  document.addEventListener("DOMContentLoaded", function () {
    window.growth && window.growth.identify([[\${#authentication.name}]]);
  });
</script>`,
          },
          {
            label: "ASP.NET",
            lang: "razor",
            code: `@if (User.Identity?.IsAuthenticated == true)
{
    <script>
      document.addEventListener("DOMContentLoaded", function () {
        window.growth && window.growth.identify(@Json.Serialize(User.FindFirst("sub")?.Value));
      });
    </script>
}`,
          },
          {
            label: "Express",
            lang: "html",
            code: `<% if (user) { %>
<script>
  document.addEventListener("DOMContentLoaded", function () {
    window.growth && window.growth.identify(<%- JSON.stringify(String(user.id)) %>);
  });
</script>
<% } %>`,
          },
        ]}
      />

      <H3>Prefer an opaque id</H3>
      <p>
        Use your own internal user id, not an email address or name. The id is stored with the visitor's events and shown
        in <strong>User Profiles</strong>. See{" "}
        <a href="/docs/tracking/identify">Identify users</a> for what is kept.
      </p>

      <H2>4. Track events that happen on the server</H2>
      <p>
        Payments, signups completed in a webhook, and background jobs have no browser to run the script. Send those from
        your backend with the <a href="/docs/server-side">HTTP API</a>, which has examples for each language above.
      </p>

      <Callout type="warning" title="Full-page caching">
        <p>
          If a CDN or page cache serves the same HTML to everyone, do not print per-user values (like the identify
          script) into cached pages. Fetch the user id with a small uncached request, or set it from your client-side
          code after sign-in.
        </p>
      </Callout>
    </DocPage>
  );
}
