#!/usr/bin/perl
# Rewrites tree-sitter highlight captures to the Argus vocabulary.
use strict; use warnings;
my %drop = map { $_ => 1 } qw(spell embedded asm glimmer nospell conceal);
sub map_capture {
  my ($n) = @_;
  return $n if $n =~ /^_/ || $n =~ /^injection\./ || $n eq 'none';
  return undef if $drop{$n};
  return 'keyword' if $n =~ /^(variable\.builtin|include|import|repeat|conditional|exception|storageclass|preproc|type\.qualifier|keyword(\..*)?)$/;
  return 'type' if $n =~ /^(constructor|namespace|module|interface|type(\..*)?)$/;
  return 'function' if $n =~ /^(function(\..*)?|method(\..*)?)$/;
  return 'constant' if $n =~ /^(boolean|label|string\.special\.symbol|constant(\..*)?)$/;
  return 'number' if $n =~ /^(float|number(\..*)?)$/;
  return 'property' if $n =~ /^(variable\.member|field|string\.special\.key|property(\..*)?)$/;
  return 'variable' if $n =~ /^(parameter(\..*)?|variable(\..*)?)$/;
  return 'punctuation' if $n =~ /^(delimiter|punctuation(\..*)?)$/;
  return 'escape' if $n =~ /^(escape|string\.escape|character\.special)$/;
  return 'regex' if $n =~ /^(string\.regexp?|string\.special\.regex)$/;
  return 'string' if $n =~ /^(character|string(\..*)?)$/;
  return 'comment' if $n =~ /^comment(\..*)?$/;
  return 'tag' if $n =~ /^tag(\..*)?$/;
  return 'attribute' if $n =~ /^attribute(\..*)?$/;
  return 'heading' if $n =~ /^(text\.title|markup\.heading(\..*)?)$/;
  return 'link' if $n =~ /^(text\.uri|text\.reference|markup\.link(\..*)?)$/;
  return 'code' if $n =~ /^(text\.literal|markup\.raw(\..*)?)$/;
  return 'emphasis' if $n eq 'text.emphasis';
  return 'strong' if $n eq 'text.strong';
  return 'operator' if $n =~ /^operator(\..*)?$/;
  warn "unmapped capture: $n\n";
  return $n;
}
while (my $line = <>) {
  if ($line =~ /^\s*;/) { print $line; next; }
  $line =~ s{("(?:[^"\\]|\\.)*")|\@([A-Za-z_][\w.\-]*)}{
    if (defined $1) { $1 } else { my $m = map_capture($2); defined $m ? "\@$m" : "" }
  }ge;
  print $line;
}
