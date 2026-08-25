Pod::Spec.new do |s|
  s.name           = 'ArgusVideo'
  s.version        = '0.1.0'
  s.summary        = 'Native H.264 renderer for the Argus device stream'
  s.description    = 'Renders AVCC access units from the Argus gateway with AVSampleBufferDisplayLayer.'
  s.author         = 'Houwert'
  s.homepage       = 'https://github.com/DouweBos/Argus'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: 'https://github.com/DouweBos/Argus' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
